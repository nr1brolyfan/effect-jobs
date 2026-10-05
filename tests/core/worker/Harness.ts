import { Clock, Effect, Result, Schema } from "effect"
import { JobId } from "../../../src/JobId.js"
import * as Lifecycle from "../../../src/JobLifecycle.js"
import * as Policy from "../../../src/JobPolicy.js"
import {
  ClaimResults,
  ClaimReconciliations,
  FinalizationResults,
  FinalizationReconciliations,
  JobOwnershipLost
} from "../../../src/JobStore.js"
import type { PreparedJob } from "../../../src/JobContract.js"
import type {
  JobStoreService,
  ClaimRequest,
  FinalizationRequest
} from "../../../src/JobStore.js"

const epoch = 1_725_000_000_000
const snapshotEquals = Schema.toEquivalence(Lifecycle.JobSnapshot)

/** Test-only, synchronous atomic state machine. NOT a durable backend. */
export const harness = (prepared: ReadonlyArray<PreparedJob> = []) => {
  const rows = prepared.map((job, index) => ({
    prepared: job as unknown,
    snapshot: {
      jobId: Schema.decodeSync(JobId)(`worker-job-${index + 1}`),
      policy: job.policy,
      state: "Pending" as const,
      availableAt: job.availableAt ?? epoch,
      updatedAt: epoch,
      attemptsMade: 0,
      stalledCount: 0,
      lifecycleVersion: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: null,
      lastFailureCode: null
    } as Lifecycle.JobSnapshot
  }))
  const calls = {
    claims: [] as Array<ClaimRequest>,
    recoveries: [] as Array<number>,
    releases: 0,
    finalizations: [] as Array<FinalizationRequest>,
    claimReconciliations: [] as Array<string>,
    finalizationReconciliations: [] as Array<FinalizationRequest>
  }
  let locked = false
  const atomic = <A>(body: (now: number) => A) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        locked = true
        try {
          return body(epoch + now)
        } finally {
          locked = false
        }
      })
    )
  const claimOf = (row: (typeof rows)[number]) => ({
    snapshot: row.snapshot,
    ownership: Result.getOrThrow(Lifecycle.ownershipOf(row.snapshot)),
    prepared: row.prepared
  })
  const store: JobStoreService<JobOwnershipLost> = {
    claim: (request) =>
      atomic((now) => {
        calls.claims.push(request)
        const row = rows.find((row) => {
          const job = prepared[rows.indexOf(row)]!
          return (
            (row.snapshot.state === "Pending" ||
              row.snapshot.state === "RetryScheduled") &&
            row.snapshot.availableAt <= now &&
            request.supportedCatalog.some(
              (entry) =>
                entry.queue === job.catalog.queue &&
                entry.kind === job.catalog.kind &&
                entry.version === job.catalog.version
            )
          )
        })
        if (row === undefined) {
          return ClaimResults.Empty()
        }
        const next = Lifecycle.claim(row.snapshot, request.leaseToken, now, 100)
        if (Result.isFailure(next)) {
          return ClaimResults.Empty()
        }
        row.snapshot = next.success
        return ClaimResults.Claimed({ claim: claimOf(row) })
      }),
    reconcileClaim: (token) =>
      atomic((now) => {
        calls.claimReconciliations.push(token)
        const row = rows.find((row) => row.snapshot.leaseToken === token)
        if (row === undefined) {
          return ClaimReconciliations.NotOwned()
        }
        return Lifecycle.usableLease(row.snapshot, now, 100)
          ? ClaimReconciliations.Owned({ claim: claimOf(row) })
          : ClaimReconciliations.InsufficientLease({ ownership: claimOf(row).ownership })
      }),
    release: (ownership, phase) =>
      atomic((now) => {
        calls.releases++
        const row = rows.find((row) => row.snapshot.jobId === ownership.jobId)!
        const next = Lifecycle.release(row.snapshot, ownership, now, phase)
        if (Result.isFailure(next)) {
          return false
        }
        row.snapshot = next.success
        return true
      }).pipe(
        Effect.flatMap((applied) =>
          applied
            ? Effect.succeed(FinalizationResults.Applied())
            : Effect.fail(new JobOwnershipLost())
        )
      ),
    finalize: (request) =>
      atomic((now) => {
        calls.finalizations.push(request)
        const row = rows.find((row) => row.snapshot.jobId === request.ownership.jobId)!
        const next = Lifecycle.finalize(
          row.snapshot,
          request.ownership,
          request.finalization,
          now
        )
        if (Result.isFailure(next)) {
          return false
        }
        row.snapshot = next.success
        return true
      }).pipe(
        Effect.flatMap((applied) =>
          applied
            ? Effect.succeed(FinalizationResults.Applied())
            : Effect.fail(new JobOwnershipLost())
        )
      ),
    reconcileFinalization: (request) =>
      atomic((now) => {
        calls.finalizationReconciliations.push(request)
        const row = rows.find((row) => row.snapshot.jobId === request.ownership.jobId)!
        if (Lifecycle.isOwned(row.snapshot, request.ownership, now)) {
          return FinalizationReconciliations.StillOwned()
        }
        const expected = Lifecycle.finalize(
          request.before,
          request.ownership,
          request.finalization,
          row.snapshot.updatedAt
        )
        return Result.isSuccess(expected) &&
          snapshotEquals(expected.success, row.snapshot)
          ? FinalizationReconciliations.Applied()
          : FinalizationReconciliations.OwnershipLost()
      }),
    recoverExpired: (limit) =>
      atomic((now) => {
        calls.recoveries.push(limit)
        let count = 0
        for (const row of rows) {
          if (count === limit) {
            break
          }
          const next = Lifecycle.recoverExpired(row.snapshot, now)
          if (Result.isSuccess(next)) {
            row.snapshot = next.success
            count++
          }
        }
        return count
      })
  }
  return { rows, calls, store, isLocked: () => locked }
}

export const policy = Policy.make()
