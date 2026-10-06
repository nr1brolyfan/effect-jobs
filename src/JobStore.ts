/**
 * Store and replaceable cleanup ports for fixed leases and bounded reconciliation.
 */
import { Data, Effect, Result, Schema } from "effect"
import { CatalogIdentity as CatalogSchema, QueueName } from "./JobIdentity.js"
import { LeaseToken } from "./JobLifecycle.js"
import type { CatalogIdentity } from "./JobIdentity.js"
import type { JobFinalization, JobOwnership, JobSnapshot } from "./JobLifecycle.js"

/**
 * Fenced claim plus untrusted prepared artifact; validate fully before handler dispatch.
 *
 * @category models
 */
export interface ClaimedJob {
  readonly ownership: JobOwnership
  readonly snapshot: JobSnapshot
  /** Untrusted artifact: validate before dispatch; never fall back to a partial payload. */
  readonly prepared: unknown
}
/**
 * Claimed, observed Empty or uncertain Unknown; reconcile Unknown by its original
 * caller token before further dispatch.
 *
 * @category models
 */
export type ClaimResult = Data.TaggedEnum<{
  Claimed: { readonly claim: ClaimedJob }
  Empty: {}
  Unknown: {}
}>
/**
 * Tagged constructors and matchers for claim results.
 *
 * @category constructors
 */
export const ClaimResults = Data.taggedEnum<ClaimResult>()
/**
 * Read-only original-token result: usable Owned, InsufficientLease, NotOwned or Unknown.
 *
 * @category models
 */
export type ClaimReconciliation = Data.TaggedEnum<{
  Owned: { readonly claim: ClaimedJob }
  InsufficientLease: { readonly ownership: JobOwnership }
  NotOwned: {}
  Unknown: {}
}>
/**
 * Tagged constructors and matchers for claim reconciliation.
 *
 * @category constructors
 */
export const ClaimReconciliations = Data.taggedEnum<ClaimReconciliation>()
/**
 * Applied or Unknown write result; response loss does not prove rollback.
 *
 * @category models
 */
export type FinalizationResult = Data.TaggedEnum<{ Applied: {}; Unknown: {} }>
/**
 * Tagged constructors and matchers for finalization results.
 *
 * @category constructors
 */
export const FinalizationResults = Data.taggedEnum<FinalizationResult>()
/**
 * Read-only exact-transition result; StillOwned permits only bounded identical
 * finalization retry, never immediate handler replay.
 *
 * @category models
 */
export type FinalizationReconciliation = Data.TaggedEnum<{
  Applied: {}
  StillOwned: {}
  OwnershipLost: {}
  Unknown: {}
}>
/**
 * Tagged constructors and matchers for finalization reconciliation.
 *
 * @category constructors
 */
export const FinalizationReconciliations = Data.taggedEnum<FinalizationReconciliation>()

/**
 * Typed rejection of a stale or expired ownership capability.
 *
 * @category errors
 */
export class JobOwnershipLost extends Data.TaggedError("JobOwnershipLost")<{}> {}
/**
 * Bounded malformed input/artifact failure, without persisted payload diagnostics.
 *
 * @category errors
 */
export class JobStoreProtocolError extends Data.TaggedError("JobStoreProtocolError")<{
  readonly reason: "invalid-input" | "invalid-artifact"
}> {}

/**
 * One supported queue/catalog selection with a fresh caller token for reconciliation.
 *
 * @category models
 */
export interface ClaimRequest {
  readonly queue: string
  /** Nonempty supported catalogs only. No process-global catalog or unsupported-version dispatch. */
  readonly supportedCatalog: ReadonlyArray<CatalogIdentity>
  /** Fresh unique caller token per claim operation, retained verbatim for reconciliation. */
  readonly leaseToken: string
}
/**
 * Exact ownership, frozen pre-write snapshot and requested durable transition.
 *
 * @category models
 */
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
/**
 * Validates queue, nonempty same-queue catalogs and token before dispatching mutation.
 * Returns Result with sanitized JobStoreProtocolError on malformed input.
 *
 * @category operations
 */
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
  /** Atomically claims at most one due supported row, reserving timeout plus response budget. */
  readonly claim: (
    request: ClaimRequest
  ) => Effect.Effect<ClaimResult, E | JobStoreProtocolError, R>
  /** Reads once using the original caller token; never invokes a handler or claims another row. */
  readonly reconcileClaim: (
    leaseToken: string
  ) => Effect.Effect<ClaimReconciliation, E | JobStoreProtocolError, R>
  /** Worker-only pre-execution boundary. Never call once decoding/handler execution has started. */
  readonly release: (
    ownership: JobOwnership,
    phase: "BeforeExecution"
  ) => Effect.Effect<FinalizationResult, E | JobOwnershipLost | JobStoreProtocolError, R>
  /** Fenced transition on exact state/token/version using DB time; Unknown requires reconciliation. */
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
  /** Bounded terminal deletion; coordinate domain references atomically. Never auto-purge Isolated. */
  readonly cleanup: (limit: number) => Effect.Effect<number, E | JobStoreProtocolError, R>
}
