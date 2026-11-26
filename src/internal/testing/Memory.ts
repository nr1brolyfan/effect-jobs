import { Clock, Context, Duration, Effect, Layer, Result, Schema } from "effect"
import {
  EnqueueResult,
  JobIntegrityConflict,
  JobPolicyIncompatible,
  type PreparedJob
} from "../../JobContract.js"
import { JobEnqueue, JobPersistenceError } from "../../JobEnqueue.js"
import { JobId } from "../../JobId.js"
import { JobAddress, ProducerIdentity, QueueName } from "../../JobIdentity.js"
import * as Lifecycle from "../../JobLifecycle.js"
import { EpochMillis, maximumMillis } from "../../JobPolicy.js"
import * as Storage from "../../JobStorage.js"
import * as Store from "../../JobStore.js"
import { bytesEqual } from "../codec/CanonicalJson.js"
import { PreparedArtifact } from "../lifecycle/Artifacts.js"
import { inspectClaim, inspectFinalization } from "../lifecycle/Reconciliation.js"

interface Row {
  readonly prepared: PreparedJob
  snapshot: Lifecycle.JobSnapshot
}

const responseBudgetMillis = 100
const decodeId = Schema.decodeSync(JobId)
const decodeArtifact = Schema.decodeUnknownResult(PreparedArtifact)
const copyPrepared = (input: unknown): Result.Result<PreparedJob, Schema.SchemaError> =>
  Result.map(decodeArtifact(input), (prepared) => {
    const { availableAt, encoded, ...metadata } = prepared
    return {
      ...metadata,
      ...(availableAt === undefined ? {} : { availableAt }),
      encoded: {
        ...encoded,
        payloadBytes: new Uint8Array(encoded.payloadBytes),
        semanticProjectionBytes: new Uint8Array(encoded.semanticProjectionBytes)
      }
    }
  })
const sameAddress = Schema.toEquivalence(JobAddress)
const sameIdentity = Schema.toEquivalence(ProducerIdentity)
const sameSnapshot = Schema.toEquivalence(Lifecycle.JobSnapshot)
const invalidInput = () => new Store.JobStoreProtocolError({ reason: "invalid-input" })
const lifecycleFailure = (error: Lifecycle.JobLifecycleError) =>
  error.reason === "ownership-lost"
    ? new Store.JobOwnershipLost()
    : new Store.JobStoreProtocolError({ reason: "invalid-artifact" })

// Sample time and mutate in one synchronous step. No operation holds a lock
// across an Effect boundary, including preparation or handler execution.
const withTime = <A, E>(run: (now: number) => Result.Result<A, E>) =>
  Clock.clockWith((clock) =>
    Effect.sync(() => run(clock.currentTimeMillisUnsafe()))
  ).pipe(Effect.flatMap(Effect.fromResult))

const claimed = (row: Row) =>
  Result.gen(function* () {
    const copy = yield* Lifecycle.validateSnapshot(row.snapshot)
    const ownership = yield* Lifecycle.ownershipOf(copy)
    return {
      snapshot: copy,
      ownership,
      prepared: yield* copyPrepared(row.prepared)
    } satisfies Store.ClaimedJob
  })

const make = Effect.gen(function* () {
  const rows = new Map<JobId, Row>()

  const store: Store.JobStoreService = {
    claim: (input) =>
      withTime((now) =>
        Result.gen(function* () {
          const request = yield* Store.validateClaimRequest(input)
          if (!Schema.is(EpochMillis)(now)) {
            return yield* Result.fail(invalidInput())
          }
          let selected: Row | undefined
          for (const row of rows.values()) {
            const { state, availableAt } = row.snapshot
            if (
              (state === "Pending" || state === "RetryScheduled") &&
              availableAt <= now &&
              request.supportedCatalog.some((entry) =>
                sameAddress(entry, row.prepared.catalog)
              ) &&
              (selected === undefined || availableAt < selected.snapshot.availableAt)
            ) {
              selected = row
            }
          }
          if (selected === undefined) {
            return Store.ClaimResult.Empty()
          }

          const next = yield* Result.mapError(
            Lifecycle.claim(
              selected.snapshot,
              request.leaseToken,
              now,
              responseBudgetMillis
            ),
            () => new JobPolicyIncompatible()
          )
          const claim = yield* Result.mapError(
            claimed({ prepared: selected.prepared, snapshot: next }),
            () => new Store.JobStoreProtocolError({ reason: "invalid-artifact" })
          )
          selected.snapshot = next
          return Store.ClaimResult.Claimed({ claim })
        })
      ),
    reconcileClaim: (token) =>
      withTime((now) =>
        Result.mapError(
          Result.gen(function* () {
            const row = Array.from(rows.values()).find(
              (row) => row.snapshot.leaseToken === token
            )
            const observed = row === undefined ? null : yield* claimed(row)
            return yield* inspectClaim(token, observed, now, responseBudgetMillis)
          }),
          invalidInput
        )
      ),
    release: (owner, phase) =>
      withTime((now) =>
        Result.gen(function* () {
          const row = rows.get(owner.jobId)
          if (row === undefined) {
            return yield* Result.fail(new Store.JobOwnershipLost())
          }
          row.snapshot = yield* Result.mapError(
            Lifecycle.release(row.snapshot, owner, now, phase),
            lifecycleFailure
          )
          return Store.FinalizationResult.Applied()
        })
      ),
    finalize: (request) =>
      withTime((now) =>
        Result.gen(function* () {
          const row = rows.get(request.ownership.jobId)
          if (row === undefined || !sameSnapshot(row.snapshot, request.before)) {
            return yield* Result.fail(new Store.JobOwnershipLost())
          }
          row.snapshot = yield* Result.mapError(
            Lifecycle.finalize(
              row.snapshot,
              request.ownership,
              request.finalization,
              now
            ),
            lifecycleFailure
          )
          return Store.FinalizationResult.Applied()
        })
      ),
    reconcileFinalization: (request) =>
      withTime((now) =>
        Result.mapError(
          inspectFinalization(
            request,
            rows.get(request.ownership.jobId)?.snapshot ?? null,
            now
          ),
          invalidInput
        )
      ),
    recoverExpired: (queue, limit) =>
      withTime((now) =>
        Result.gen(function* () {
          if (
            !Schema.is(QueueName)(queue) ||
            !Schema.is(Lifecycle.BatchLimit)(limit) ||
            !Schema.is(EpochMillis)(now)
          ) {
            return yield* Result.fail(invalidInput())
          }
          const updates: Array<{
            readonly row: Row
            readonly next: Lifecycle.JobSnapshot
          }> = []
          for (const row of rows.values()) {
            if (row.prepared.catalog.queue !== queue) {
              continue
            }
            const result = Lifecycle.recoverExpired(row.snapshot, now)
            if (Result.isFailure(result)) {
              if (result.failure.reason === "not-eligible") {
                continue
              }
              return yield* Result.fail(
                new Store.JobStoreProtocolError({ reason: "invalid-artifact" })
              )
            }
            updates.push({ row, next: result.success })
            if (updates.length === limit) {
              break
            }
          }
          for (const { row, next } of updates) {
            row.snapshot = next
          }
          return updates.length
        })
      )
  }

  const insert = (input: PreparedJob) =>
    withTime((now) =>
      Result.gen(function* () {
        const prepared = yield* Result.mapError(
          copyPrepared(input),
          () =>
            new JobPersistenceError({
              reason: "storage-failure",
              commitKnowledge: "NotCommitted"
            })
        )
        const { producer, catalog, encoded, policy } = prepared
        const existing = Array.from(rows.values()).find((row) =>
          sameIdentity(row.prepared.producer, producer)
        )
        if (existing !== undefined) {
          if (
            existing.prepared.catalog.name !== catalog.name ||
            existing.prepared.catalog.version !== catalog.version ||
            !bytesEqual(
              existing.prepared.encoded.semanticProjectionBytes,
              encoded.semanticProjectionBytes
            )
          ) {
            return yield* Result.fail(new JobIntegrityConflict())
          }
          return EnqueueResult.AlreadyPresent({ jobId: existing.snapshot.jobId })
        }

        const reserveMillis = policy.leaseDurationMillis - policy.attemptTimeoutMillis
        if (reserveMillis < responseBudgetMillis) {
          return yield* Result.fail(
            new JobPolicyIncompatible({
              reserveMillis,
              requiredMillis: responseBudgetMillis
            })
          )
        }
        if (
          !Schema.is(EpochMillis)(now) ||
          policy.leaseDurationMillis > maximumMillis - now
        ) {
          return yield* Result.fail(new JobPolicyIncompatible())
        }

        const jobId = decodeId(`memory-${rows.size + 1}`)
        const row: Row = {
          prepared,
          snapshot: {
            jobId,
            policy,
            state: "Pending",
            availableAt: prepared.availableAt ?? now,
            createdAt: now,
            updatedAt: now,
            finalizedAttempts: 0,
            stalledCount: 0,
            lifecycleVersion: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: null,
            lastFailureCode: null
          }
        }
        rows.set(jobId, row)
        return EnqueueResult.Inserted({ jobId })
      })
    )

  const storage = yield* Storage.make({
    store,
    operationResponseBudget: Duration.millis(responseBudgetMillis)
  })
  return Context.make(Storage.JobStorage, storage).pipe(
    Context.add(
      JobEnqueue,
      JobEnqueue.of({
        enqueue: () =>
          Effect.fail(
            new JobPersistenceError({
              reason: "transaction-required",
              commitKnowledge: "NotCommitted"
            })
          ),
        enqueueStandalone: Effect.flatMap(insert)
      })
    )
  )
})

export const layer = Layer.effectContext(make)
