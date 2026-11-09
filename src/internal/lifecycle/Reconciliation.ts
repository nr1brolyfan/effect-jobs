import { Data, Effect, Result, Schema } from "effect"
import * as Lifecycle from "../../JobLifecycle.js"
import * as Store from "../../JobStore.js"
import { EpochMillis } from "../../JobPolicy.js"
import type { JobPolicyIncompatible } from "../../JobContract.js"

/** Read reconciliation is evidence of the exact original command, never permission to replay a handler. */
export const inspectFinalization = (
  request: Store.FinalizationRequest,
  observed: unknown,
  dbNow: number
): Result.Result<Store.FinalizationReconciliation, Lifecycle.JobLifecycleError> =>
  Result.gen(function* () {
    const before = yield* Lifecycle.validateSnapshot(request.before)
    const originalOwnership = yield* Lifecycle.ownershipOf(before)
    if (
      !Schema.is(Lifecycle.JobOwnership)(request.ownership) ||
      !Schema.is(Lifecycle.JobFinalization)(request.finalization) ||
      !Schema.is(EpochMillis)(dbNow) ||
      !Schema.toEquivalence(Lifecycle.JobOwnership)(originalOwnership, request.ownership)
    ) {
      return yield* Result.fail(
        new Lifecycle.JobLifecycleError({ reason: "invalid-command" })
      )
    }
    if (observed === null) {
      return Store.FinalizationReconciliation.OwnershipLost()
    }
    const row = yield* Lifecycle.validateSnapshot(observed)
    const expected = Lifecycle.finalize(
      before,
      request.ownership,
      request.finalization,
      row.updatedAt
    )
    if (
      Result.isSuccess(expected) &&
      Schema.toEquivalence(Lifecycle.JobSnapshot)(row, expected.success)
    ) {
      return Store.FinalizationReconciliation.Applied()
    }
    return Lifecycle.isOwned(row, request.ownership, dbNow) &&
      Schema.toEquivalence(Lifecycle.JobSnapshot)(row, before)
      ? Store.FinalizationReconciliation.StillOwned()
      : Store.FinalizationReconciliation.OwnershipLost()
  })

/** One original-token storage read; absence is evidence only for that claim. */
export const inspectClaim = (
  leaseToken: string,
  observed: Store.ClaimedJob | null,
  dbNow: number,
  operationResponseBudgetMillis: number
): Result.Result<Store.ClaimReconciliation, Lifecycle.JobLifecycleError> =>
  Result.gen(function* () {
    if (
      !Schema.is(Lifecycle.LeaseToken)(leaseToken) ||
      !Schema.is(EpochMillis)(dbNow) ||
      !Schema.is(EpochMillis)(operationResponseBudgetMillis)
    ) {
      return yield* Result.fail(
        new Lifecycle.JobLifecycleError({ reason: "invalid-command" })
      )
    }
    if (observed === null) {
      return Store.ClaimReconciliation.NotOwned()
    }
    const row = yield* Lifecycle.validateSnapshot(observed.snapshot)
    const ownership = yield* Lifecycle.ownershipOf(row)
    if (
      !Schema.is(Lifecycle.JobOwnership)(observed.ownership) ||
      !Schema.toEquivalence(Lifecycle.JobOwnership)(ownership, observed.ownership)
    ) {
      return yield* Result.fail(
        new Lifecycle.JobLifecycleError({ reason: "invalid-command" })
      )
    }
    if (ownership.leaseToken !== leaseToken) {
      return Store.ClaimReconciliation.NotOwned()
    }
    return Lifecycle.usableLease(row, dbNow, operationResponseBudgetMillis)
      ? Store.ClaimReconciliation.Owned({ claim: observed })
      : Store.ClaimReconciliation.InsufficientLease({ ownership })
  })

export type ClaimResolution = Data.TaggedEnum<{
  Ready: { readonly claim: Store.ClaimedJob }
  Skipped: {}
  Deferred: {}
}>
export const ClaimResolution = Data.taggedEnum<ClaimResolution>()

/** One original-token read at most. Insufficient leases may be released ONLY before execution. */
export const resolveClaim = <E, R>(
  store: Store.JobStoreService<E, R>,
  request: Store.ClaimRequest
): Effect.Effect<
  ClaimResolution,
  E | Store.JobStoreProtocolError | Store.JobOwnershipLost | JobPolicyIncompatible,
  R
> =>
  Effect.gen(function* () {
    const result = yield* store.claim(request)
    if (result._tag === "Claimed") {
      return ClaimResolution.Ready({ claim: result.claim })
    }
    if (result._tag === "Empty") {
      return ClaimResolution.Skipped()
    }
    const reconciled = yield* store.reconcileClaim(request.leaseToken)
    switch (reconciled._tag) {
      case "Owned":
        return ClaimResolution.Ready({ claim: reconciled.claim })
      case "NotOwned":
        return ClaimResolution.Skipped()
      case "Unknown":
        return ClaimResolution.Deferred()
      case "InsufficientLease": {
        const released = yield* store.release(reconciled.ownership, "BeforeExecution")
        return released._tag === "Applied"
          ? ClaimResolution.Skipped()
          : ClaimResolution.Deferred()
      }
    }
  })

export type FinalizationResolution = "Applied" | "OwnershipLost" | "Deferred"
/** One read and at most ONE identical finalization retry. Never retries execution or loops on Unknown. */
export const resolveFinalization = <E, R>(
  store: Store.JobStoreService<E, R>,
  request: Store.FinalizationRequest
): Effect.Effect<
  FinalizationResolution,
  E | Store.JobStoreProtocolError | Store.JobOwnershipLost,
  R
> =>
  Effect.gen(function* () {
    const result = yield* store.finalize(request)
    if (result._tag === "Applied") {
      return "Applied"
    }
    const reconciled = yield* store.reconcileFinalization(request)
    switch (reconciled._tag) {
      case "Applied":
        return "Applied"
      case "OwnershipLost":
        return "OwnershipLost"
      case "Unknown":
        return "Deferred"
      case "StillOwned": {
        const repeated = yield* store.finalize(request)
        return repeated._tag === "Applied" ? "Applied" : "Deferred"
      }
    }
  })
