import { Context, Effect } from "effect"
import type { JobFinalization } from "../../src/JobLifecycle.js"
import type {
  JobStoreService,
  JobCleanupService,
  JobOwnershipLost,
  JobStoreProtocolError,
  ClaimResult,
  FinalizationResult
} from "../../src/JobStore.js"
import {
  resolveClaim,
  resolveFinalization
} from "../../src/internal/lifecycle/Reconciliation.js"
import type { ClaimRequest, FinalizationRequest } from "../../src/JobStore.js"

export class Connection extends Context.Service<Connection, {}>()(
  "tests/lifecycle/Connection"
) {}
declare const store: JobStoreService<"provider-failure", Connection>
declare const cleanup: JobCleanupService<"cleanup-failure", Connection>
declare const claim: ClaimRequest
declare const finalization: FinalizationRequest
export const claimed: Effect.Effect<
  ClaimResult,
  "provider-failure" | JobStoreProtocolError,
  Connection
> = store.claim(claim)
export const finalized: Effect.Effect<
  FinalizationResult,
  "provider-failure" | JobStoreProtocolError | JobOwnershipLost,
  Connection
> = store.finalize(finalization)
export const resolvedClaim = resolveClaim(store, claim)
export const resolvedFinalization = resolveFinalization(store, finalization)
export const cleaned: Effect.Effect<
  number,
  "cleanup-failure" | JobStoreProtocolError,
  Connection
> = cleanup.cleanup(100)
type ExpectFalse<A extends false> = A
export type MissingRequirement = ExpectFalse<
  typeof resolvedClaim extends Effect.Effect<unknown, unknown> ? true : false
>
export type MissingProviderError = ExpectFalse<
  typeof resolvedFinalization extends Effect.Effect<
    unknown,
    JobStoreProtocolError | JobOwnershipLost,
    Connection
  >
    ? true
    : false
>
export type MissingCleanupRequirement = ExpectFalse<
  typeof cleaned extends Effect.Effect<unknown, unknown> ? true : false
>
// @ts-expect-error OutcomeUnknown is not a durable finalization command.
export const unknown: JobFinalization = { _tag: "OutcomeUnknown", code: "lost_response" }
// @ts-expect-error Only the pre-execution phase can release ownership through the port.
export const invalidRelease = store.release(finalization.ownership, "Executing")
// @ts-expect-error The exact original pre-write snapshot is required for reconciliation.
export const incomplete: FinalizationRequest = {
  ownership: finalization.ownership,
  finalization: finalization.finalization
}
