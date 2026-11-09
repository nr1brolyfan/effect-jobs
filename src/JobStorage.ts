/** Configured portable execution storage. Construction starts no database work. */
import { Context, Data, Effect, Layer, Schema } from "effect"
import { EpochMillis } from "./JobPolicy.js"
import { JobPolicyIncompatible } from "./JobContract.js"
import { JobOwnershipLost, JobStoreProtocolError } from "./JobStore.js"
import type { JobStoreService } from "./JobStore.js"

/** Invalid storage configuration; no provider or payload values are retained. */
export class JobStorageConfigurationError extends Data.TaggedError(
  "JobStorageConfigurationError"
)<{
  readonly field: "operationResponseBudgetMillis"
}> {}

/** Safe infrastructure failure. Does not prove that a dispatched write rolled back. */
export class JobStorageUnavailable extends Data.TaggedError(
  "JobStorageUnavailable"
)<{}> {}

/** Adapter input. The qualified store must use this same budget for admission. */
export interface Options<E, R> {
  readonly store: JobStoreService<E, R>
  readonly operationResponseBudgetMillis: number
}

/** Captured execution port and its one positive finite response reserve. */
export interface JobStorageService {
  readonly store: JobStoreService<JobStorageUnavailable>
  readonly operationResponseBudgetMillis: number
}

/** Application-selected storage, independent of SQL peers and handler groups. */
export class JobStorage extends Context.Service<JobStorage, JobStorageService>()(
  "effect-jobs/JobStorage"
) {}

const protocolError = (error: unknown) =>
  error instanceof JobStoreProtocolError ? error : new JobStorageUnavailable()
const ownershipError = (error: unknown) =>
  error instanceof JobOwnershipLost ? error : protocolError(error)
const admissionError = (error: unknown) =>
  error instanceof JobPolicyIncompatible ? error : protocolError(error)

/**
 * Captures provider requirements once and snapshots the budget. Typed provider
 * failures cross a safe infrastructure boundary; library protocol/admission errors,
 * defects, interruptions and explicit Unknown results retain their semantics.
 * Own the source's lifetime outside this service; no borrowing, readiness, DDL,
 * polling, cleanup or pool shutdown occurs here. This is not an atomicity proof.
 */
export const make = <E, R>(options: Options<E, R>) =>
  Effect.gen(function* () {
    const budget = options.operationResponseBudgetMillis
    if (!Schema.is(EpochMillis)(budget) || budget === 0) {
      return yield* new JobStorageConfigurationError({
        field: "operationResponseBudgetMillis"
      })
    }
    const source = options.store
    const services = yield* Effect.context<R>()
    const store = Object.freeze<JobStoreService<JobStorageUnavailable>>({
      claim: (request) =>
        Effect.suspend(() => source.claim(request)).pipe(
          Effect.provide(services),
          Effect.mapError(admissionError)
        ),
      reconcileClaim: (token) =>
        Effect.suspend(() => source.reconcileClaim(token)).pipe(
          Effect.provide(services),
          Effect.mapError(protocolError)
        ),
      release: (owner, phase) =>
        Effect.suspend(() => source.release(owner, phase)).pipe(
          Effect.provide(services),
          Effect.mapError(ownershipError)
        ),
      finalize: (request) =>
        Effect.suspend(() => source.finalize(request)).pipe(
          Effect.provide(services),
          Effect.mapError(ownershipError)
        ),
      reconcileFinalization: (request) =>
        Effect.suspend(() => source.reconcileFinalization(request)).pipe(
          Effect.provide(services),
          Effect.mapError(protocolError)
        ),
      recoverExpired: (queue, limit) =>
        Effect.suspend(() => source.recoverExpired(queue, limit)).pipe(
          Effect.provide(services),
          Effect.mapError(protocolError)
        )
    })
    return Object.freeze(JobStorage.of({ store, operationResponseBudgetMillis: budget }))
  })

/** Provides captured storage; source requirements remain visible on the Layer. */
export const layer = <E, R>(options: Options<E, R>) =>
  Layer.effect(JobStorage, make(options))
