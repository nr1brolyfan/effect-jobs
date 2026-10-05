import { Duration, Result, Schema } from "effect"
import { JobId } from "../../../src/JobId.js"
import * as Lifecycle from "../../../src/JobLifecycle.js"
import * as Policy from "../../../src/JobPolicy.js"
import type * as Store from "../../../src/JobStore.js"

export const now = 100_000
export const token = "abcd-1234"
export const policy = Policy.make({
  leaseDuration: Duration.millis(100),
  attemptTimeout: Duration.millis(30),
  retryDelay: Duration.millis(5),
  completedRetention: Duration.millis(10)
})
export const pending = (
  overrides: Partial<Lifecycle.JobSnapshot> = {}
): Lifecycle.JobSnapshot => ({
  jobId: Schema.decodeSync(JobId)("job-1"),
  policy,
  state: "Pending",
  availableAt: now,
  updatedAt: now - 1,
  attemptsMade: 0,
  stalledCount: 0,
  lifecycleVersion: 0,
  leaseToken: null,
  leaseExpiresAt: null,
  completedAt: null,
  lastFailureCode: null,
  ...overrides
})
export const active = (
  overrides: Partial<Lifecycle.JobSnapshot> = {}
): Lifecycle.JobSnapshot => ({
  ...Result.getOrThrow(Lifecycle.claim(pending(), token, now, 10)),
  ...overrides
})
export const ownership = (row = active()) => Result.getOrThrow(Lifecycle.ownershipOf(row))
export const request: Store.ClaimRequest = {
  queue: "billing",
  supportedCatalog: [{ queue: "billing", kind: "invoice", version: 1 }],
  leaseToken: token
}
export const prepared = () => ({
  catalog: request.supportedCatalog[0]!,
  producer: { operation: "billing.issue", operationId: "operation-1", slot: "pdf" },
  policy,
  encoded: {
    formatVersion: 1,
    payloadBytes: new TextEncoder().encode("{}"),
    semanticProjectionBytes: new TextEncoder().encode("{}")
  }
})
export const claimed = (): Store.ClaimedJob => ({
  snapshot: active(),
  ownership: ownership(),
  prepared: prepared()
})
export const finalizationRequest = (
  finalization: Lifecycle.JobFinalization = Lifecycle.JobFinalizations.Complete()
): Store.FinalizationRequest => ({
  before: active(),
  ownership: ownership(),
  finalization
})
