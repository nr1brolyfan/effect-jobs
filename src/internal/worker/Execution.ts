import { Cause, Effect, Exit, Result, Schema } from "effect"
import { JobPayloadCodecError } from "../../JobContract.js"
import { CatalogIdentity, ProducerIdentity } from "../../JobIdentity.js"
import {
  JobFinalizations,
  JobOwnership,
  JobSnapshot,
  attemptNumber,
  finalizationFromFailure
} from "../../JobLifecycle.js"
import { EpochMillis, PersistedJobPolicy } from "../../JobPolicy.js"
import { observe } from "../../JobTelemetry.js"
import type { JobHandler } from "../../JobRegistry.js"
import type { ClaimedJob, FinalizationRequest, JobStoreService } from "../../JobStore.js"
import type { JobFinalization } from "../../JobLifecycle.js"

const PreparedMetadata = Schema.Struct({
  catalog: CatalogIdentity,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  availableAt: Schema.optional(EpochMillis),
  encoded: Schema.Struct({
    formatVersion: Schema.Literal(1),
    payloadBytes: Schema.declare(
      (value): value is Uint8Array => value instanceof Uint8Array
    ),
    semanticProjectionBytes: Schema.declare(
      (value): value is Uint8Array => value instanceof Uint8Array
    )
  })
})
const policyEquals = Schema.toEquivalence(PersistedJobPolicy)

const finalizationFor = (exit: Exit.Exit<void, unknown>): JobFinalization | null => {
  if (Exit.isSuccess(exit)) {
    return JobFinalizations.Complete()
  }
  const [reason] = exit.cause.reasons
  if (
    exit.cause.reasons.length !== 1 ||
    reason === undefined ||
    !Cause.isFailReason(reason)
  ) {
    return null
  }
  if (reason.error instanceof JobPayloadCodecError) {
    return JobFinalizations.Isolate({ code: "invalid_claimed_artifact" })
  }
  const result = finalizationFromFailure(reason.error)
  return Result.isSuccess(result) ? result.success : null
}

/** One attempt deadline covers validation, handler and the entire bounded protocol. */
export const executionFor = <E>(
  store: JobStoreService<E>,
  claim: ClaimedJob,
  find: (catalog: CatalogIdentity) => JobHandler | undefined,
  supported: ReadonlyArray<CatalogIdentity>,
  responseBudgetMillis: number
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const snapshot = Schema.decodeResult(JobSnapshot, { onExcessProperty: "error" })(
      claim.snapshot
    )
    const owner = Schema.decodeResult(JobOwnership, { onExcessProperty: "error" })(
      claim.ownership
    )
    // Without trustworthy ownership and a full durable budget no write is safe.
    if (Result.isFailure(snapshot) || Result.isFailure(owner)) {
      return Effect.void
    }
    const before = snapshot.success
    const ownership = owner.success
    if (
      before.state !== "Active" ||
      before.jobId !== ownership.jobId ||
      before.leaseToken !== ownership.leaseToken ||
      before.leaseExpiresAt !== ownership.leaseExpiresAt ||
      before.lifecycleVersion !== ownership.lifecycleVersion
    ) {
      return Effect.void
    }

    const finalize = (finalization: JobFinalization) => {
      const request: FinalizationRequest = Object.freeze({
        ownership: Object.freeze(ownership),
        before: Object.freeze({
          ...before,
          policy: Object.freeze({
            ...before.policy,
            retrySchedule: Object.freeze({ ...before.policy.retrySchedule }),
            completedRetention: Object.freeze({ ...before.policy.completedRetention }),
            deadRetention: Object.freeze({ ...before.policy.deadRetention })
          })
        }),
        finalization: Object.freeze(finalization)
      })
      const write = () =>
        Effect.suspend(() => store.finalize(request)).pipe(
          Effect.timeoutOrElse({
            duration: responseBudgetMillis,
            orElse: () => Effect.succeed({ _tag: "Unknown" as const })
          }),
          observe("finalize", "finalization")
        )
      return Effect.gen(function* () {
        const result = yield* write()
        if (result._tag === "Applied") {
          return result
        }
        const reconciled = yield* Effect.suspend(() =>
          store.reconcileFinalization(request)
        ).pipe(
          Effect.timeout(responseBudgetMillis),
          observe("finalize", "reconciliation")
        )
        // Only exact StillOwned proof permits ONE fenced repeat of this same
        // transition. No second reconciliation, handler rerun or fresh ownership.
        if (reconciled._tag === "StillOwned") {
          return yield* write()
        }
        return reconciled._tag === "Applied"
          ? { _tag: "Applied" as const }
          : { _tag: "Unknown" as const }
      }).pipe(observe("finalize", "protocol"), Effect.ignore)
    }
    return Effect.gen(function* () {
      const prepared = yield* Schema.decodeUnknownEffect(PreparedMetadata)(
        claim.prepared,
        { onExcessProperty: "error" }
      ).pipe(Effect.result)
      if (
        Result.isFailure(prepared) ||
        !policyEquals(prepared.success.policy, before.policy)
      ) {
        return yield* finalize(
          JobFinalizations.Isolate({ code: "invalid_claimed_artifact" })
        )
      }
      const { catalog, producer, encoded } = prepared.success
      // A store protocol violation must not consume unsupported-version counters.
      if (
        !supported.some(
          (entry) =>
            entry.queue === catalog.queue &&
            entry.kind === catalog.kind &&
            entry.version === catalog.version
        )
      ) {
        return
      }
      const handler = find(catalog)
      if (handler === undefined) {
        return
      }
      if (
        encoded.payloadBytes.byteLength > 65_536 ||
        encoded.semanticProjectionBytes.byteLength > 65_536
      ) {
        return yield* finalize(
          JobFinalizations.Isolate({ code: "invalid_claimed_artifact" })
        )
      }
      const context = Object.freeze({
        jobId: before.jobId,
        catalog: Object.freeze(catalog),
        producer: Object.freeze(producer),
        attemptNumber: attemptNumber(before)
      })
      const copied = {
        formatVersion: encoded.formatVersion,
        payloadBytes: new Uint8Array(encoded.payloadBytes),
        semanticProjectionBytes: new Uint8Array(encoded.semanticProjectionBytes)
      }
      const exit = yield* Effect.suspend(() => handler.execute(copied, context)).pipe(
        observe("execute", "handler"),
        Effect.exit
      )
      const finalization = finalizationFor(exit)
      if (finalization !== null) {
        yield* finalize(finalization)
      }
    }).pipe(Effect.timeout(before.policy.attemptTimeoutMillis), Effect.ignore)
  })
