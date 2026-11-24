import { Data, Effect, Result, Schema } from "effect"
import type { EncodedJobPayload, JobPolicyIncompatible } from "../../JobContract.js"
import { QueueName } from "../../JobIdentity.js"
import * as Lifecycle from "../../JobLifecycle.js"
import { PersistedJobPolicy } from "../../JobPolicy.js"
import * as Store from "../../JobStore.js"
import { validateClaimArtifact } from "../lifecycle/Artifacts.js"
import * as Reconciliation from "../lifecycle/Reconciliation.js"
import {
  attemptSql,
  incompatiblePolicy,
  SqliteSqlFault,
  storageTime,
  type JobRow,
  type SqlStorage,
  type Storage
} from "./Storage.js"

const selectClaim = `SELECT j.*, p.formatVersion, p.payload, p.projection
  FROM jobs j LEFT JOIN payloads p ON p.jobId = j.jobId`

const FinalizationRequest = Schema.Struct({
  ownership: Lifecycle.JobOwnership,
  before: Lifecycle.JobSnapshot,
  finalization: Lifecycle.JobFinalization
})
const sameSnapshot = Schema.toEquivalence(Lifecycle.JobSnapshot)
const sameOwnership = Schema.toEquivalence(Lifecycle.JobOwnership)
const sameFinalizationRequest = Schema.toEquivalence(FinalizationRequest)
const strict = { onExcessProperty: "error" } as const
const decodeStoredPolicy = Schema.decodeUnknownResult(
  Schema.fromJsonString(PersistedJobPolicy),
  strict
)
const FinalizationReceipt = Schema.fromJsonString(FinalizationRequest)
const encodeFinalizationReceipt = Schema.encodeResult(FinalizationReceipt)
const decodeFinalizationReceipt = Schema.decodeUnknownResult(FinalizationReceipt, strict)

class SqliteStoreUnavailable extends Data.TaggedError("SqliteStoreUnavailable")<{
  readonly commitKnowledge: "Unknown"
}> {}

const invalidInput = () => new Store.JobStoreProtocolError({ reason: "invalid-input" })
const invalidArtifact = () =>
  new Store.JobStoreProtocolError({ reason: "invalid-artifact" })

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Result.mapError(Schema.decodeUnknownResult(schema, strict)(input), invalidInput)

const snapshot = (row: JobRow) =>
  Result.gen(function* () {
    const policy = yield* Result.mapError(decodeStoredPolicy(row.policy), invalidArtifact)
    return yield* Result.mapError(
      Lifecycle.validateSnapshot({
        jobId: row.jobId,
        state: row.state,
        policy,
        availableAt: row.availableAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        finalizedAttempts: row.finalizedAttempts,
        stalledCount: row.stalledCount,
        lifecycleVersion: row.lifecycleVersion,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
        completedAt: row.completedAt,
        lastFailureCode: row.lastFailureCode
      }),
      invalidArtifact
    )
  })

const claimedJob = (row: JobRow, stored: Lifecycle.JobSnapshot) =>
  Result.gen(function* () {
    if (
      row.formatVersion !== 1 ||
      !(row.payload instanceof ArrayBuffer) ||
      !(row.projection instanceof ArrayBuffer)
    ) {
      return yield* Result.fail(invalidArtifact())
    }
    const encoded: EncodedJobPayload = {
      formatVersion: row.formatVersion,
      payloadBytes: new Uint8Array(row.payload),
      semanticProjectionBytes: new Uint8Array(row.projection)
    }
    const claim: Store.ClaimedJob = {
      ownership: yield* Result.mapError(Lifecycle.ownershipOf(stored), invalidArtifact),
      snapshot: stored,
      prepared: {
        catalog: { queue: row.queue, name: row.name, version: row.version },
        producer: {
          operation: row.operation,
          operationId: row.operationId,
          slot: row.slot
        },
        policy: stored.policy,
        ...(row.initialAvailableAt === null
          ? {}
          : { availableAt: row.initialAvailableAt }),
        encoded
      }
    }
    const prepared = yield* validateClaimArtifact(claim)
    return { ...claim, prepared }
  })

const write = <E>(
  sql: SqlStorage,
  before: Lifecycle.JobSnapshot,
  after: Lifecycle.JobSnapshot,
  receipt: string | null,
  onFenceMiss: () => E
) =>
  Result.gen(function* () {
    const rows = yield* attemptSql(() =>
      sql
        .exec(
          `UPDATE jobs SET state = ?, availableAt = ?, updatedAt = ?, finalizedAttempts = ?,
          stalledCount = ?, lifecycleVersion = ?, leaseToken = ?, leaseExpiresAt = ?,
          completedAt = ?, lastFailureCode = ?, finalizationReceipt = ?
        WHERE jobId = ? AND state = ? AND lifecycleVersion = ?
          AND leaseToken IS ? AND leaseExpiresAt IS ? RETURNING jobId`,
          after.state,
          after.availableAt,
          after.updatedAt,
          after.finalizedAttempts,
          after.stalledCount,
          after.lifecycleVersion,
          after.leaseToken,
          after.leaseExpiresAt,
          after.completedAt,
          after.lastFailureCode,
          receipt,
          before.jobId,
          before.state,
          before.lifecycleVersion,
          before.leaseToken,
          before.leaseExpiresAt
        )
        .toArray()
    )
    if (rows.length === 0) {
      return yield* Result.fail(onFenceMiss())
    }
    if (rows.length !== 1) {
      return yield* Result.fail(invalidArtifact())
    }
  })

const ownershipLost = () => new Store.JobOwnershipLost()
const commandError = (error: Lifecycle.JobLifecycleError) =>
  error.reason === "invalid-command" ? invalidInput() : invalidArtifact()
const ownedCommandError = (error: Lifecycle.JobLifecycleError) =>
  error.reason === "ownership-lost" ? ownershipLost() : commandError(error)

// The application owns the object, migration and operation response budget.
export const makeStore = (native: Storage, responseBudgetMillis: number) => {
  const sql = native.sql
  const transact = <
    A,
    E extends Store.JobStoreProtocolError | Store.JobOwnershipLost | JobPolicyIncompatible
  >(
    body: () => Result.Result<A, E | SqliteSqlFault>
  ) =>
    Effect.suspend((): Effect.Effect<A, E | SqliteStoreUnavailable> => {
      const abort = {}
      let failure: Result.Failure<A, E | SqliteSqlFault> | undefined
      let defect: { readonly value: unknown } | undefined
      try {
        return Effect.succeed(
          native.transactionSync(() => {
            try {
              const result = body()
              if (Result.isSuccess(result)) {
                return result.success
              }
              failure = result
            } catch (value) {
              defect = { value }
            }
            // Returning a failed Result normally commits earlier writes. Only
            // this invocation's sentinel confirms the native callback unwound.
            throw abort
          })
        )
      } catch (error) {
        if (defect !== undefined) {
          return Effect.die(defect.value)
        }
        if (error === abort && failure !== undefined) {
          const cause = failure.failure
          if (!(cause instanceof SqliteSqlFault)) {
            return Effect.fail(cause)
          }
        }
        // A native SQL or transaction-control failure leaves the port without
        // a storage acknowledgment. The sync barrier handles post-commit loss.
        return Effect.fail(new SqliteStoreUnavailable({ commitKnowledge: "Unknown" }))
      }
    })

  const sync = Effect.tryPromise({
    try: () => native.sync(),
    catch: () => new SqliteStoreUnavailable({ commitKnowledge: "Unknown" })
  })

  const claim = (input: unknown) =>
    Effect.suspend(() => {
      const startedAt = performance.now()
      return transact(() =>
        Result.gen(function* () {
          const request = yield* Store.validateClaimRequest(input)
          const now = yield* storageTime(sql)
          const catalog = JSON.stringify(request.supportedCatalog)
          const [row] = yield* attemptSql(() =>
            sql
              .exec<JobRow>(
                `${selectClaim} WHERE j.queue = ? AND j.availableAt <= ?
          AND j.state IN ('Pending','RetryScheduled')
          AND EXISTS (SELECT 1 FROM json_each(?) catalog
            WHERE json_extract(catalog.value, '$.name') = j.name
              AND json_extract(catalog.value, '$.version') = j.version)
        ORDER BY j.availableAt, j.jobId LIMIT 1`,
                request.queue,
                now,
                catalog
              )
              .toArray()
          )
          if (row === undefined) {
            return Store.ClaimResult.Empty()
          }
          const before = yield* snapshot(row)
          const incompatible = incompatiblePolicy(
            before.policy,
            now,
            responseBudgetMillis
          )
          if (incompatible !== undefined) {
            return yield* Result.fail(incompatible)
          }
          const after = yield* Result.mapError(
            Lifecycle.claim(before, request.leaseToken, now, responseBudgetMillis),
            commandError
          )
          const claim = yield* claimedJob(row, after)
          yield* write(sql, before, after, null, invalidArtifact)
          return Store.ClaimResult.Claimed({ claim })
        })
      ).pipe(
        Effect.flatMap(
          (result): Effect.Effect<Store.ClaimResult, SqliteStoreUnavailable> =>
            result._tag === "Empty"
              ? Effect.succeed(result)
              : sync.pipe(
                  Effect.map(() => {
                    const snapshot = result.claim.snapshot
                    // The only absolute time comes from SQLite. Subtract the entire
                    // operation's elapsed time conservatively, including the barrier.
                    const elapsed = Math.ceil(performance.now() - startedAt) + 1
                    return Lifecycle.usableLease(
                      snapshot,
                      snapshot.updatedAt + elapsed,
                      responseBudgetMillis
                    )
                      ? result
                      : Store.ClaimResult.Unknown()
                  })
                )
        ),
        Effect.catchTags({
          SqliteStoreUnavailable: () => Effect.succeed(Store.ClaimResult.Unknown())
        })
      )
    })

  const reconcileClaim = (input: unknown) =>
    transact(() =>
      Result.gen(function* () {
        const token = yield* decode(Lifecycle.LeaseToken, input)
        const now = yield* storageTime(sql)
        const [row] = yield* attemptSql(() =>
          sql.exec<JobRow>(`${selectClaim} WHERE j.leaseToken = ?`, token).toArray()
        )
        const claim =
          row === undefined
            ? null
            : yield* Result.flatMap(snapshot(row), (stored) => claimedJob(row, stored))
        return yield* Result.mapError(
          Reconciliation.inspectClaim(token, claim, now, responseBudgetMillis),
          commandError
        )
      })
    ).pipe(
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.ClaimReconciliation.Unknown())
      })
    )

  const readJob = (jobId: Lifecycle.JobOwnership["jobId"]) =>
    Result.map(
      attemptSql(() =>
        sql.exec<JobRow>("SELECT * FROM jobs WHERE jobId = ?", jobId).toArray()
      ),
      ([row]) => row
    )

  const readOwned = (ownership: Lifecycle.JobOwnership, now: number) =>
    Result.gen(function* () {
      const row = yield* readJob(ownership.jobId)
      if (row === undefined) {
        return yield* Result.fail(ownershipLost())
      }
      const before = yield* snapshot(row)
      return Lifecycle.isOwned(before, ownership, now)
        ? before
        : yield* Result.fail(ownershipLost())
    })

  const release = (input: unknown, phase: "BeforeExecution") =>
    transact(() =>
      Result.gen(function* () {
        const ownership = yield* decode(Lifecycle.JobOwnership, input)
        const now = yield* storageTime(sql)
        const before = yield* readOwned(ownership, now)
        const after = yield* Result.mapError(
          Lifecycle.release(before, ownership, now, phase),
          ownedCommandError
        )
        return yield* write(sql, before, after, null, ownershipLost)
      })
    ).pipe(
      Effect.andThen(sync),
      Effect.as(Store.FinalizationResult.Applied()),
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.FinalizationResult.Unknown())
      })
    )

  const finalize = (input: unknown) =>
    transact(() =>
      Result.gen(function* () {
        const request = yield* decode(FinalizationRequest, input)
        const claimed = yield* Result.mapError(
          Lifecycle.ownershipOf(request.before),
          invalidInput
        )
        if (!sameOwnership(claimed, request.ownership)) {
          return yield* Result.fail(invalidInput())
        }
        const now = yield* storageTime(sql)
        const before = yield* readOwned(request.ownership, now)
        if (!sameSnapshot(before, request.before)) {
          return yield* Result.fail(ownershipLost())
        }
        const after = yield* Result.mapError(
          Lifecycle.finalize(before, request.ownership, request.finalization, now),
          ownedCommandError
        )
        // Keep the latest exact evidence of the request, including commands that
        // produce an identical terminal row. Clear it on other lifecycle writes.
        const receipt = yield* Result.mapError(
          encodeFinalizationReceipt(request),
          invalidInput
        )
        return yield* write(sql, before, after, receipt, ownershipLost)
      })
    ).pipe(
      Effect.andThen(sync),
      Effect.as(Store.FinalizationResult.Applied()),
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.FinalizationResult.Unknown())
      })
    )

  const reconcileFinalization = (input: unknown) =>
    transact(() =>
      Result.gen(function* () {
        const request = yield* decode(FinalizationRequest, input)
        const now = yield* storageTime(sql)
        const row = yield* readJob(request.ownership.jobId)
        const before = row === undefined ? null : yield* snapshot(row)
        const result = yield* Result.mapError(
          Reconciliation.inspectFinalization(request, before, now),
          commandError
        )
        if (result._tag !== "Applied") {
          return result
        }
        const receipt = row?.finalizationReceipt
        if (receipt === null || receipt === undefined) {
          return Store.FinalizationReconciliation.OwnershipLost()
        }
        const original = yield* Result.mapError(
          decodeFinalizationReceipt(receipt),
          invalidArtifact
        )
        return sameFinalizationRequest(original, request)
          ? result
          : Store.FinalizationReconciliation.OwnershipLost()
      })
    ).pipe(
      Effect.catchTags({
        SqliteStoreUnavailable: () =>
          Effect.succeed(Store.FinalizationReconciliation.Unknown())
      })
    )

  const recoverExpired = (queueInput: unknown, limitInput: unknown) =>
    transact(() =>
      Result.gen(function* () {
        const queue = yield* decode(QueueName, queueInput)
        const limit = yield* decode(Lifecycle.BatchLimit, limitInput)
        const now = yield* storageTime(sql)
        const rows = yield* attemptSql(() =>
          sql
            .exec<JobRow>(
              `SELECT * FROM jobs WHERE queue = ? AND state = 'Active' AND leaseExpiresAt <= ?
        ORDER BY leaseExpiresAt, jobId LIMIT ?`,
              queue,
              now,
              limit
            )
            .toArray()
        )
        for (const row of rows) {
          const before = yield* snapshot(row)
          const after = yield* Result.mapError(
            Lifecycle.recoverExpired(before, now),
            invalidArtifact
          )
          yield* write(sql, before, after, null, invalidArtifact)
        }
        return rows.length
      })
    ).pipe(Effect.tap(() => sync))

  return {
    claim,
    reconcileClaim,
    release,
    finalize,
    reconcileFinalization,
    recoverExpired
  } satisfies Store.JobStoreService<SqliteStoreUnavailable>
}
