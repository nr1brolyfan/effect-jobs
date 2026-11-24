import { Data, Effect, Match, Result, Schema } from "effect"
import { JobPolicyIncompatible, type EncodedJobPayload } from "../../JobContract.js"
import { QueueName } from "../../JobIdentity.js"
import * as Lifecycle from "../../JobLifecycle.js"
import { maximumMillis, PersistedJobPolicy } from "../../JobPolicy.js"
import * as Store from "../../JobStore.js"
import { validateClaimArtifact } from "../lifecycle/Artifacts.js"
import * as Reconciliation from "../lifecycle/Reconciliation.js"

import { storageTime, type JobRow, type SqlStorage, type Storage } from "./Storage.js"

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
const encodeFinalizationReceipt = Schema.encodeSync(FinalizationReceipt)
const decodeFinalizationReceipt = Schema.decodeUnknownResult(FinalizationReceipt, strict)

class SqliteStoreUnavailable extends Data.TaggedError("SqliteStoreUnavailable")<{
  readonly commitKnowledge: "Unknown"
}> {}

const invalidInput = () => new Store.JobStoreProtocolError({ reason: "invalid-input" })
const invalidArtifact = () =>
  new Store.JobStoreProtocolError({ reason: "invalid-artifact" })

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw result.failure
  }
  return result.success
}

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  requireSuccess(
    Result.mapError(Schema.decodeUnknownResult(schema, strict)(input), invalidInput)
  )

const snapshot = (row: JobRow): Lifecycle.JobSnapshot => {
  const policy = requireSuccess(
    Result.mapError(decodeStoredPolicy(row.policy), invalidArtifact)
  )
  return requireSuccess(
    Result.mapError(
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
  )
}

const claimedJob = (row: JobRow, stored: Lifecycle.JobSnapshot): Store.ClaimedJob => {
  if (
    row.formatVersion !== 1 ||
    !(row.payload instanceof ArrayBuffer) ||
    !(row.projection instanceof ArrayBuffer)
  ) {
    throw invalidArtifact()
  }
  const encoded: EncodedJobPayload = {
    formatVersion: row.formatVersion,
    payloadBytes: new Uint8Array(row.payload),
    semanticProjectionBytes: new Uint8Array(row.projection)
  }
  const claim: Store.ClaimedJob = {
    ownership: requireSuccess(Lifecycle.ownershipOf(stored)),
    snapshot: stored,
    prepared: {
      catalog: { queue: row.queue, name: row.name, version: row.version },
      producer: {
        operation: row.operation,
        operationId: row.operationId,
        slot: row.slot
      },
      policy: stored.policy,
      ...(row.initialAvailableAt === null ? {} : { availableAt: row.initialAvailableAt }),
      encoded
    }
  }
  return { ...claim, prepared: requireSuccess(validateClaimArtifact(claim)) }
}

const write = (
  sql: SqlStorage,
  before: Lifecycle.JobSnapshot,
  after: Lifecycle.JobSnapshot,
  receipt: string | null
) => {
  const update = sql.exec(
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
  if (update.toArray().length !== 1) {
    throw new Store.JobOwnershipLost()
  }
}

const asProtocolError = (error: unknown) => {
  if (
    error instanceof Store.JobStoreProtocolError ||
    error instanceof Store.JobOwnershipLost ||
    error instanceof JobPolicyIncompatible
  ) {
    return error
  }
  if (error instanceof Lifecycle.JobLifecycleError) {
    return Match.value(error.reason).pipe(
      Match.when("ownership-lost", () => new Store.JobOwnershipLost()),
      Match.when("invalid-command", invalidInput),
      Match.orElse(invalidArtifact)
    )
  }
  return new SqliteStoreUnavailable({ commitKnowledge: "Unknown" })
}

// The application owns the object, migration and operation response budget.
export const makeStore = (native: Storage, responseBudgetMillis: number) => {
  const sql = native.sql
  const transact = <A, E>(body: () => A, onError: (error: unknown) => E) =>
    Effect.try({
      try: () => native.transactionSync(body),
      catch: onError
    })

  const readError = (error: unknown) => {
    const failure = asProtocolError(error)
    return failure instanceof Store.JobStoreProtocolError ||
      failure instanceof SqliteStoreUnavailable
      ? failure
      : invalidArtifact()
  }
  const ownershipError = (error: unknown) => {
    const failure = asProtocolError(error)
    return failure instanceof JobPolicyIncompatible ? invalidArtifact() : failure
  }
  const claimError = (error: unknown) => {
    const failure = asProtocolError(error)
    return failure instanceof Store.JobOwnershipLost ? invalidArtifact() : failure
  }

  const sync = Effect.tryPromise({
    try: () => native.sync(),
    catch: () => new SqliteStoreUnavailable({ commitKnowledge: "Unknown" })
  })

  const claim = (input: unknown) =>
    Effect.suspend(() => {
      const startedAt = performance.now()
      return transact(() => {
        const request = requireSuccess(Store.validateClaimRequest(input))
        const now = storageTime(sql)
        const row = sql
          .exec<JobRow>(
            `${selectClaim} WHERE j.queue = ? AND j.availableAt <= ?
          AND j.state IN ('Pending','RetryScheduled')
          AND EXISTS (SELECT 1 FROM json_each(?) catalog
            WHERE json_extract(catalog.value, '$.name') = j.name
              AND json_extract(catalog.value, '$.version') = j.version)
        ORDER BY j.availableAt, j.jobId LIMIT 1`,
            request.queue,
            now,
            JSON.stringify(request.supportedCatalog)
          )
          .toArray()[0]
        if (row === undefined) {
          return Store.ClaimResult.Empty()
        }
        const before = snapshot(row)
        const { leaseDurationMillis, attemptTimeoutMillis } = before.policy
        const reserveMillis = leaseDurationMillis - attemptTimeoutMillis
        if (reserveMillis < responseBudgetMillis) {
          throw new JobPolicyIncompatible({
            reserveMillis,
            requiredMillis: responseBudgetMillis
          })
        }
        if (leaseDurationMillis > maximumMillis - now) {
          throw new JobPolicyIncompatible()
        }
        const after = requireSuccess(
          Lifecycle.claim(before, request.leaseToken, now, responseBudgetMillis)
        )
        const claim = claimedJob(row, after)
        write(sql, before, after, null)
        return Store.ClaimResult.Claimed({ claim })
      }, claimError).pipe(
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
    transact(() => {
      const token = decode(Lifecycle.LeaseToken, input)
      const now = storageTime(sql)
      const row = sql
        .exec<JobRow>(`${selectClaim} WHERE j.leaseToken = ?`, token)
        .toArray()[0]
      return requireSuccess(
        Reconciliation.inspectClaim(
          token,
          row === undefined ? null : claimedJob(row, snapshot(row)),
          now,
          responseBudgetMillis
        )
      )
    }, readError).pipe(
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.ClaimReconciliation.Unknown())
      })
    )

  const readOwned = (ownership: Lifecycle.JobOwnership, now: number) => {
    const row = sql
      .exec<JobRow>("SELECT * FROM jobs WHERE jobId = ?", ownership.jobId)
      .toArray()[0]
    if (row === undefined) {
      throw new Store.JobOwnershipLost()
    }
    const before = snapshot(row)
    if (!Lifecycle.isOwned(before, ownership, now)) {
      throw new Store.JobOwnershipLost()
    }
    return before
  }

  const release = (input: unknown, phase: "BeforeExecution") =>
    transact(() => {
      const ownership = decode(Lifecycle.JobOwnership, input)
      const now = storageTime(sql)
      const before = readOwned(ownership, now)
      write(
        sql,
        before,
        requireSuccess(Lifecycle.release(before, ownership, now, phase)),
        null
      )
    }, ownershipError).pipe(
      Effect.andThen(sync),
      Effect.as(Store.FinalizationResult.Applied()),
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.FinalizationResult.Unknown())
      })
    )

  const finalize = (input: unknown) =>
    transact(() => {
      const request = decode(FinalizationRequest, input)
      const claimed = Lifecycle.ownershipOf(request.before)
      if (
        Result.isFailure(claimed) ||
        !sameOwnership(claimed.success, request.ownership)
      ) {
        throw invalidInput()
      }
      const now = storageTime(sql)
      const before = readOwned(request.ownership, now)
      if (!sameSnapshot(before, request.before)) {
        throw new Store.JobOwnershipLost()
      }
      const after = requireSuccess(
        Lifecycle.finalize(before, request.ownership, request.finalization, now)
      )
      // Keep the latest exact evidence of the request, including commands that
      // produce an identical terminal row. Clear it on other lifecycle writes.
      write(sql, before, after, encodeFinalizationReceipt(request))
    }, ownershipError).pipe(
      Effect.andThen(sync),
      Effect.as(Store.FinalizationResult.Applied()),
      Effect.catchTags({
        SqliteStoreUnavailable: () => Effect.succeed(Store.FinalizationResult.Unknown())
      })
    )

  const reconcileFinalization = (input: unknown) =>
    transact(() => {
      const request = decode(FinalizationRequest, input)
      const now = storageTime(sql)
      const row = sql
        .exec<JobRow>("SELECT * FROM jobs WHERE jobId = ?", request.ownership.jobId)
        .toArray()[0]
      const result = requireSuccess(
        Reconciliation.inspectFinalization(
          request,
          row === undefined ? null : snapshot(row),
          now
        )
      )
      if (result._tag !== "Applied") {
        return result
      }
      const receipt = row?.finalizationReceipt
      if (receipt === null || receipt === undefined) {
        return Store.FinalizationReconciliation.OwnershipLost()
      }
      const original = requireSuccess(
        Result.mapError(decodeFinalizationReceipt(receipt), invalidArtifact)
      )
      return sameFinalizationRequest(original, request)
        ? result
        : Store.FinalizationReconciliation.OwnershipLost()
    }, readError).pipe(
      Effect.catchTags({
        SqliteStoreUnavailable: () =>
          Effect.succeed(Store.FinalizationReconciliation.Unknown())
      })
    )

  const recoverExpired = (queueInput: unknown, limitInput: unknown) =>
    transact(() => {
      const queue = decode(QueueName, queueInput)
      const limit = decode(Lifecycle.BatchLimit, limitInput)
      const now = storageTime(sql)
      const rows = sql
        .exec<JobRow>(
          `SELECT * FROM jobs WHERE queue = ? AND state = 'Active' AND leaseExpiresAt <= ?
        ORDER BY leaseExpiresAt, jobId LIMIT ?`,
          queue,
          now,
          limit
        )
        .toArray()
      for (const row of rows) {
        const before = snapshot(row)
        write(sql, before, requireSuccess(Lifecycle.recoverExpired(before, now)), null)
      }
      return rows.length
    }, readError).pipe(Effect.tap(() => sync))

  return {
    claim,
    reconcileClaim,
    release,
    finalize,
    reconcileFinalization,
    recoverExpired
  } satisfies Store.JobStoreService<SqliteStoreUnavailable>
}
