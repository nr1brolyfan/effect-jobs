import { Data, Effect, Result, Schema } from "effect"
import { CatalogIdentity as CatalogSchema, QueueName } from "./JobIdentity.js"
import { LeaseToken } from "./JobLifecycle.js"
import type { CatalogIdentity } from "./JobIdentity.js"
import type { JobFinalization, JobOwnership, JobSnapshot } from "./JobLifecycle.js"

export interface ClaimedJob {
  readonly ownership: JobOwnership
  readonly snapshot: JobSnapshot
  /** Untrusted artifact: validate before dispatch; never fall back to a partial payload. */
  readonly prepared: unknown
}
export type ClaimResult = Data.TaggedEnum<{
  Claimed: { readonly claim: ClaimedJob }
  Empty: {}
  Unknown: {}
}>
export const ClaimResults = Data.taggedEnum<ClaimResult>()
export type ClaimReconciliation = Data.TaggedEnum<{
  Owned: { readonly claim: ClaimedJob }
  InsufficientLease: { readonly ownership: JobOwnership }
  NotOwned: {}
  Unknown: {}
}>
export const ClaimReconciliations = Data.taggedEnum<ClaimReconciliation>()
export type FinalizationResult = Data.TaggedEnum<{ Applied: {}; Unknown: {} }>
export const FinalizationResults = Data.taggedEnum<FinalizationResult>()
export type FinalizationReconciliation = Data.TaggedEnum<{
  Applied: {}
  StillOwned: {}
  OwnershipLost: {}
  Unknown: {}
}>
export const FinalizationReconciliations = Data.taggedEnum<FinalizationReconciliation>()

export class JobOwnershipLost extends Data.TaggedError("JobOwnershipLost")<{}> {}
export class JobStoreProtocolError extends Data.TaggedError("JobStoreProtocolError")<{
  readonly reason: "invalid-input" | "invalid-artifact"
}> {}

export interface ClaimRequest {
  readonly queue: string
  /** Nonempty supported catalogs only. No process-global catalog or unsupported-version dispatch. */
  readonly supportedCatalog: ReadonlyArray<CatalogIdentity>
  /** Fresh unique caller token per claim operation, retained verbatim for reconciliation. */
  readonly leaseToken: string
}
export interface FinalizationRequest {
  readonly ownership: JobOwnership
  /** Frozen pre-write snapshot makes exact transition reconciliation possible. */
  readonly before: JobSnapshot
  readonly finalization: JobFinalization
}

const ClaimRequestSchema = Schema.Struct({
  queue: QueueName,
  supportedCatalog: Schema.Array(CatalogSchema).pipe(Schema.check(Schema.isMinLength(1))),
  leaseToken: LeaseToken
}).pipe(
  Schema.check(
    Schema.makeFilter((request) =>
      request.supportedCatalog.every((catalog) => catalog.queue === request.queue)
    )
  )
)
/** Backend boundary validation, before any mutation is dispatched. */
export const validateClaimRequest = (
  input: unknown
): Result.Result<ClaimRequest, JobStoreProtocolError> =>
  Result.mapError(
    Schema.decodeUnknownResult(ClaimRequestSchema, { onExcessProperty: "error" })(input),
    () => new JobStoreProtocolError({ reason: "invalid-input" })
  )

/**
 * Explicit configured port, not a backend constructor or atomicity proof.
 * E/R preserve provider failure and connection requirements. Unknown dispatched writes
 * MUST be returned as Unknown (including response loss); typed failures cannot imply rollback.
 * Never replay mutations automatically. Lock/CAS the exact state/token/version using one
 * DB-time snapshot, fixed non-renewable leases and bounded validated arithmetic.
 * Claim atomically selects at most one due supported row and its immutable payload;
 * its lease must reserve stored timeout plus configured positive operation-response budget.
 * Reconciliation reads once by the ORIGINAL caller token, never by an unrelated new claim.
 * All transitions preserve first policy, identities and artifact bytes; no lease renewal.
 */
export interface JobStoreService<E = never, R = never> {
  readonly claim: (
    request: ClaimRequest
  ) => Effect.Effect<ClaimResult, E | JobStoreProtocolError, R>
  readonly reconcileClaim: (
    leaseToken: string
  ) => Effect.Effect<ClaimReconciliation, E | JobStoreProtocolError, R>
  /** Worker-only pre-execution boundary. Never call once decoding/handler execution has started. */
  readonly release: (
    ownership: JobOwnership,
    phase: "BeforeExecution"
  ) => Effect.Effect<FinalizationResult, E | JobOwnershipLost | JobStoreProtocolError, R>
  readonly finalize: (
    request: FinalizationRequest
  ) => Effect.Effect<FinalizationResult, E | JobOwnershipLost | JobStoreProtocolError, R>
  /** Applied requires the exact transition/counter/code/timestamp/version, not terminal state alone. */
  readonly reconcileFinalization: (
    request: FinalizationRequest
  ) => Effect.Effect<FinalizationReconciliation, E | JobStoreProtocolError, R>
  /** Atomic, bounded 1–500 batch; expiry <= DB time; no handler invocation. */
  readonly recoverExpired: (
    limit: number
  ) => Effect.Effect<number, E | JobStoreProtocolError, R>
}

/** Separate replaceable app-owned port; the store must not bypass domain references. */
export interface JobCleanupService<E = never, R = never> {
  readonly cleanup: (limit: number) => Effect.Effect<number, E | JobStoreProtocolError, R>
}
