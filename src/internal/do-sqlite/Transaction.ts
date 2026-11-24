import { Data, Effect, Exit, Fiber, Result, Scheduler, Schema } from "effect"
import {
  EnqueueResult,
  JobIntegrityConflict,
  type JobPolicyIncompatible,
  type PreparedJob
} from "../../JobContract.js"
import { JobId } from "../../JobId.js"
import { PersistedJobPolicy } from "../../JobPolicy.js"
import type { JobsTransaction } from "../../JobTransaction.js"
import { withJoinedTransaction } from "../JobTransaction.js"
import {
  incompatiblePolicy,
  storageTime,
  type SqlStorage,
  type TransactionStorage
} from "./Storage.js"

export class SqliteTransactionClosed extends Data.TaggedError(
  "SqliteTransactionClosed"
)<{}> {}
export class SqliteTransactionUnavailable extends Data.TaggedError(
  "SqliteTransactionUnavailable"
)<{
  readonly commitKnowledge: "Unknown"
}> {}
export class SqliteWriteFailed extends Data.TaggedError("SqliteWriteFailed")<{}> {}

const decodeJobId = Schema.decodeUnknownSync(JobId)
const encodePolicy = Schema.encodeSync(Schema.fromJsonString(PersistedJobPolicy))

const insertOrCompare = (
  sql: SqlStorage,
  prepared: PreparedJob,
  operationResponseBudgetMillis: number
): Result.Result<EnqueueResult, JobPolicyIncompatible> => {
  const { producer, catalog, encoded } = prepared
  const existing = sql
    .exec<{
      jobId: string
      name: string
      version: number
      sameProjection: number | null
    }>(
      `SELECT j.jobId, j.name, j.version, p.projection = ? AS sameProjection
      FROM jobs j LEFT JOIN payloads p ON j.jobId = p.jobId
      WHERE j.operation = ? AND j.operationId = ? AND j.slot = ?`,
      encoded.semanticProjectionBytes,
      producer.operation,
      producer.operationId,
      producer.slot
    )
    .toArray()[0]
  if (existing !== undefined) {
    if (existing.sameProjection === null) {
      throw new SqliteWriteFailed()
    }
    if (
      existing.name !== catalog.name ||
      existing.version !== catalog.version ||
      existing.sameProjection !== 1
    ) {
      throw new JobIntegrityConflict()
    }
    return Result.succeed(
      EnqueueResult.AlreadyPresent({ jobId: decodeJobId(existing.jobId) })
    )
  }
  const now = storageTime(sql)
  const incompatible = incompatiblePolicy(
    prepared.policy,
    now,
    operationResponseBudgetMillis
  )
  if (incompatible !== undefined) {
    return Result.fail(incompatible)
  }
  const jobId = decodeJobId(crypto.randomUUID())
  sql.exec(
    `INSERT INTO jobs (jobId, queue, name, version, operation, operationId, slot,
        policy, initialAvailableAt, state, availableAt, createdAt, updatedAt,
        finalizedAttempts, stalledCount, lifecycleVersion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, 0, 0, 0)`,
    jobId,
    catalog.queue,
    catalog.name,
    catalog.version,
    producer.operation,
    producer.operationId,
    producer.slot,
    encodePolicy(prepared.policy),
    prepared.availableAt ?? null,
    prepared.availableAt ?? now,
    now,
    now
  )
  sql.exec(
    "INSERT INTO payloads (jobId, formatVersion, payload, projection) VALUES (?, ?, ?, ?)",
    jobId,
    encoded.formatVersion,
    encoded.payloadBytes,
    encoded.semanticProjectionBytes
  )
  return Result.succeed(EnqueueResult.Inserted({ jobId }))
}

type WriteFailure = SqliteTransactionClosed | JobIntegrityConflict | SqliteWriteFailed
type Write = <A>(action: (sql: SqlStorage) => A) => Effect.Effect<A, WriteFailure>

const joined = <A, E, R>(
  sql: SqlStorage,
  operationResponseBudgetMillis: number,
  body: (
    transaction: JobsTransaction<WriteFailure>,
    write: Write
  ) => Effect.Effect<A, E, R>
) =>
  Effect.suspend(() => {
    let active = true
    let doomed: JobIntegrityConflict | SqliteWriteFailed | undefined
    const write: Write = (action) =>
      Effect.suspend((): Effect.Effect<ReturnType<typeof action>, WriteFailure> => {
        if (!active) {
          return Effect.fail(new SqliteTransactionClosed())
        }
        if (doomed !== undefined) {
          return Effect.fail(doomed)
        }
        return Effect.try({
          try: () => action(sql),
          catch: (error) => {
            doomed =
              error instanceof JobIntegrityConflict ? error : new SqliteWriteFailed()
            return doomed
          }
        })
      })

    return withJoinedTransaction(
      // Policy rejection is an admission result before either insert. A caught
      // rejection leaves the transaction usable, unlike a conflict or SQL error.
      (prepared) =>
        write((sql) =>
          insertOrCompare(sql, prepared, operationResponseBudgetMillis)
        ).pipe(Effect.flatMap(Effect.fromResult)),
      (transaction) => body(transaction, write)
    ).pipe(
      Effect.flatMap((value) =>
        doomed === undefined ? Effect.succeed(value) : Effect.fail(doomed)
      ),
      Effect.ensuring(
        Effect.sync(() => {
          active = false
        })
      )
    )
  })

// The owner awaits native settlement. Interruption first stops the scoped callback,
// causing native rollback, then waits for that rollback to settle.
// The application supplies one SQLite DO storage, opens this boundary once per
// operation, and keeps domain writes synchronous through write. The caller
// owns application receipts, the sync acknowledgment barrier and reconciliation.
export const withTransaction = <A, E, R>(
  native: TransactionStorage,
  operationResponseBudgetMillis: number,
  body: (
    transaction: JobsTransaction<WriteFailure>,
    write: Write
  ) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Effect.context<R>()
      // A DO input gate can block timers while its native transaction is open.
      const scheduler = new Scheduler.MixedScheduler("sync")
      let cancelled = false
      let owner: Fiber.Fiber<unknown, unknown> | undefined
      let settlement: Promise<A> | undefined

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          cancelled = true
          if (owner !== undefined) {
            yield* Fiber.interrupt(owner)
          }
          const pending = settlement
          if (pending !== undefined) {
            yield* Effect.promise(() =>
              pending.then(
                () => undefined,
                () => undefined
              )
            )
          }
        })
      )

      return yield* Effect.callback<
        A,
        E | JobIntegrityConflict | SqliteWriteFailed | SqliteTransactionUnavailable
      >((resume) => {
        let rollback:
          | Exit.Failure<A, E | JobIntegrityConflict | SqliteWriteFailed>
          | undefined
        const reject = (reason: unknown) => {
          resume(
            rollback !== undefined && reason === rollback
              ? Effect.failCause(rollback.cause)
              : Effect.fail(
                  new SqliteTransactionUnavailable({ commitKnowledge: "Unknown" })
                )
          )
        }
        try {
          settlement = native.transaction(() => {
            if (cancelled) {
              return Promise.reject(new SqliteTransactionClosed())
            }
            return new Promise<A>((resolve, rejectBody) => {
              const fiber = Effect.runForkWith(context)(
                Effect.withFiber((fiber) => {
                  owner = fiber
                  return joined(native.sql, operationResponseBudgetMillis, body)
                }),
                { scheduler }
              )
              fiber.addObserver((exit) => {
                if (Exit.isSuccess(exit)) {
                  resolve(exit.value)
                } else {
                  rollback = exit
                  rejectBody(exit)
                }
              })
            })
          })
          settlement.then((value) => resume(Effect.succeed(value)), reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  )
