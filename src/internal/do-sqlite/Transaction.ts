import { Data, Effect, Exit, Fiber, Result, Scheduler, Schema } from "effect"
import {
  EnqueueResult,
  JobIntegrityConflict,
  type JobPolicyIncompatible,
  type PreparedJob
} from "../../JobContract.js"
import { JobId } from "../../JobId.js"
import { PersistedJobPolicy } from "../../JobPolicy.js"
import { JobStoreProtocolError } from "../../JobStore.js"
import type { JobsTransaction } from "../../JobTransaction.js"
import { withJoinedTransaction } from "../JobTransaction.js"
import {
  attemptSql,
  incompatiblePolicy,
  storageTime,
  type JobRow,
  SqliteSqlFault,
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

const decodeJobId = Schema.decodeUnknownResult(JobId)
const encodePolicy = Schema.encodeResult(Schema.fromJsonString(PersistedJobPolicy))
const invalidArtifact = () => new JobStoreProtocolError({ reason: "invalid-artifact" })

const insertOrCompare = (
  sql: SqlStorage,
  prepared: PreparedJob,
  operationResponseBudgetMillis: number
) =>
  Result.gen(function* () {
    const { producer, catalog, encoded } = prepared
    const [existing] = yield* attemptSql(() =>
      sql
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
        .toArray()
    )
    if (existing !== undefined) {
      if (existing.sameProjection === null) {
        return yield* Result.fail(invalidArtifact())
      }
      if (
        existing.name !== catalog.name ||
        existing.version !== catalog.version ||
        existing.sameProjection !== 1
      ) {
        return yield* Result.fail(new JobIntegrityConflict())
      }
      const jobId = yield* Result.mapError(decodeJobId(existing.jobId), invalidArtifact)
      return EnqueueResult.AlreadyPresent({ jobId })
    }

    const now = yield* storageTime(sql)
    const incompatible = incompatiblePolicy(
      prepared.policy,
      now,
      operationResponseBudgetMillis
    )
    if (incompatible !== undefined) {
      return yield* Result.fail(incompatible)
    }
    const jobId = yield* Result.mapError(
      decodeJobId(crypto.randomUUID()),
      invalidArtifact
    )
    const policy = yield* Result.mapError(
      encodePolicy(prepared.policy),
      () => new JobStoreProtocolError({ reason: "invalid-input" })
    )
    yield* attemptSql(() =>
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
        policy,
        prepared.availableAt ?? null,
        prepared.availableAt ?? now,
        now,
        now
      )
    )
    yield* attemptSql(() =>
      sql.exec(
        "INSERT INTO payloads (jobId, formatVersion, payload, projection) VALUES (?, ?, ?, ?)",
        jobId,
        encoded.formatVersion,
        encoded.payloadBytes,
        encoded.semanticProjectionBytes
      )
    )
    return EnqueueResult.Inserted({ jobId })
  })

type RollbackFailure = JobIntegrityConflict | JobStoreProtocolError | SqliteWriteFailed
type WriteFailure = SqliteTransactionClosed | RollbackFailure
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
    let doomed: RollbackFailure | undefined
    let writeDefect: { readonly value: unknown } | undefined
    const dieOnWriteDefect = (value: unknown) => {
      writeDefect ??= { value }
      return Effect.die(value)
    }
    const whileWritable = <B, F>(run: () => Effect.Effect<B, F>) =>
      Effect.suspend((): Effect.Effect<B, F | WriteFailure> => {
        if (!active) {
          return Effect.fail(new SqliteTransactionClosed())
        }
        if (writeDefect !== undefined) {
          return Effect.die(writeDefect.value)
        }
        return doomed === undefined ? run() : Effect.fail(doomed)
      })

    // Application writes use the native cursor shape. Mark SQL faults at the
    // actual call, even if application code catches the native exception.
    let sqlFailure: { readonly error: unknown } | undefined
    const trackSqlFault = <B>(run: () => B): B => {
      try {
        return run()
      } catch (error) {
        sqlFailure = { error }
        doomed ??= new SqliteWriteFailed()
        throw error
      }
    }
    const trackedSql: SqlStorage = {
      exec<Row extends JobRow>(...args: Parameters<SqlStorage["exec"]>) {
        const cursor = trackSqlFault(() => sql.exec<Row>(...args))
        return {
          toArray: () => trackSqlFault(() => cursor.toArray()),
          one: () => trackSqlFault(() => cursor.one())
        }
      }
    }
    const write: Write = (action) =>
      whileWritable(() => {
        try {
          const value = action(trackedSql)
          return doomed === undefined ? Effect.succeed(value) : Effect.fail(doomed)
        } catch (defect) {
          return sqlFailure !== undefined &&
            Object.is(sqlFailure.error, defect) &&
            doomed !== undefined
            ? Effect.fail(doomed)
            : dieOnWriteDefect(defect)
        }
      })

    return withJoinedTransaction(
      (prepared) =>
        whileWritable(
          (): Effect.Effect<EnqueueResult, RollbackFailure | JobPolicyIncompatible> => {
            try {
              const result = insertOrCompare(sql, prepared, operationResponseBudgetMillis)
              if (Result.isSuccess(result)) {
                return Effect.succeed(result.success)
              }
              const failure = result.failure
              // Admission rejects before either insert and can be handled in place.
              if (failure._tag === "JobPolicyIncompatible") {
                return Effect.fail(failure)
              }
              doomed =
                failure instanceof SqliteSqlFault ? new SqliteWriteFailed() : failure
              return Effect.fail(doomed)
            } catch (defect) {
              return dieOnWriteDefect(defect)
            }
          }
        ),
      (transaction) => body(transaction, write)
    ).pipe(
      Effect.flatMap((value) => {
        if (writeDefect !== undefined) {
          return Effect.die(writeDefect.value)
        }
        return doomed === undefined ? Effect.succeed(value) : Effect.fail(doomed)
      }),
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
        E | RollbackFailure | SqliteTransactionUnavailable
      >((resume) => {
        let rollback: Exit.Failure<A, E | RollbackFailure> | undefined
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
