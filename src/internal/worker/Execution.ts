import { define as defineFailureCodes } from "../../FailureCode.js"
import { Cause, Data, Effect, Exit, Random, Result, Schema } from "effect"
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
import { observe, schedulingLag } from "../../JobTelemetry.js"
import type { JobHandler } from "../../JobRegistry.js"
import type { ClaimedJob, FinalizationRequest, JobStoreService } from "../../JobStore.js"
import { FinalizationResults } from "../../JobStore.js"
import type { JobFinalization } from "../../JobLifecycle.js"

type AttemptResult = Data.TaggedEnum<{
  InvalidOwnership: {}
  Unsupported: {}
  Abandoned: {}
  Unknown: {}
  Complete: {}
  Retry: {}
  Dead: {}
  Isolate: {}
}>
const AttemptResult = Data.taggedEnum<AttemptResult>()

const PreparedMetadata = Schema.Struct({
  catalog: CatalogIdentity,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  availableAt: EpochMillis.pipe(Schema.optional),
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
    return JobFinalizations.Isolate({ code: internalCodes.invalid_claimed_artifact })
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
      return Effect.succeed(AttemptResult.InvalidOwnership())
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
      return Effect.succeed(AttemptResult.InvalidOwnership())
    }

    const finalize = Effect.fnUntraced(function* (finalization: JobFinalization) {
      yield* Effect.annotateCurrentSpan({ "jobs.attempt_phase": "finalization" })
      const command =
        finalization._tag === "Retry" &&
        before.attemptsMade + 1 < before.policy.maxAttempts &&
        before.policy.retrySchedule._tag === "BackoffV1" &&
        before.policy.retrySchedule.jitter !== "None"
          ? JobFinalizations.Retry({ ...finalization, jitterSample: yield* Random.next })
          : finalization
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
        finalization: Object.freeze(command)
      })
      const write = () =>
        Effect.suspend(() => store.finalize(request)).pipe(
          Effect.timeoutOrElse({
            duration: responseBudgetMillis,
            orElse: () => Effect.succeed({ _tag: "Unknown" as const })
          }),
          observe("finalize", "finalization")
        )
      return yield* Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({ "jobs.requested": finalization._tag })
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
      }).pipe(
        observe("finalize", "protocol"),
        Effect.orElseSucceed(() => FinalizationResults.Unknown()),
        Effect.map((result): AttemptResult =>
          result._tag === "Unknown"
            ? AttemptResult.Unknown()
            : AttemptResult[finalization._tag]()
        )
      )
    })
    return Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({ "jobs.attempt_phase": "validation" })
      yield* schedulingLag(before.updatedAt, before.availableAt)
      const prepared = yield* Schema.decodeUnknownEffect(PreparedMetadata)(
        claim.prepared,
        { onExcessProperty: "error" }
      ).pipe(Effect.result)
      if (
        Result.isFailure(prepared) ||
        !policyEquals(prepared.success.policy, before.policy)
      ) {
        return yield* finalize(
          JobFinalizations.Isolate({ code: internalCodes.invalid_claimed_artifact })
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
        return AttemptResult.Unsupported()
      }
      const handler = find(catalog)
      if (handler === undefined) {
        return AttemptResult.Unsupported()
      }
      if (
        encoded.payloadBytes.byteLength > 65_536 ||
        encoded.semanticProjectionBytes.byteLength > 65_536
      ) {
        return yield* finalize(
          JobFinalizations.Isolate({ code: internalCodes.invalid_claimed_artifact })
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
      yield* Effect.annotateCurrentSpan({ "jobs.attempt_phase": "decode-and-handler" })
      const exit = yield* Effect.suspend(() => handler.execute(copied, context)).pipe(
        observe("execute", "handler"),
        Effect.exit
      )
      const finalization = finalizationFor(exit)
      if (finalization !== null) {
        return yield* finalize(finalization)
      }
      return AttemptResult.Unknown()
    }).pipe(Effect.timeout(before.policy.attemptTimeoutMillis))
  }).pipe(observe("attempt", "protocol"), Effect.asVoid, Effect.ignore)

const internalCodes = defineFailureCodes({
  invalid_claimed_artifact: "invalid_claimed_artifact"
})
