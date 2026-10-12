import { Context, Effect, Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { Counter, JobState } from "effect-jobs/JobLifecycle"
import { EpochMillis } from "effect-jobs/JobPolicy"
import { SandboxRef, type SandboxAccess } from "./Sandbox.js"
import { RequestId } from "./Scenarios.js"
import { PlaygroundError } from "./Services.js"

export const JobOperatorAction = Schema.Literals(["retry-now", "cancel", "redrive"])
export type JobOperatorAction = typeof JobOperatorAction.Type
const guard = {
  sandbox: SandboxRef,
  requestId: RequestId,
  jobId: JobId,
  expectedState: JobState,
  expectedLifecycleVersion: Counter
}
export const JobOperatorCommand = Schema.Union([
  Schema.Struct({ ...guard, action: Schema.Literals(["retry-now", "cancel"]) }),
  Schema.Struct({
    ...guard,
    action: Schema.Literal("redrive"),
    confirmDuplicateEffects: Schema.Literal(true)
  })
])
export type JobOperatorCommand = typeof JobOperatorCommand.Type
export const JobOperatorReason = Schema.Literals([
  "invalid-input",
  "not-found",
  "state-version-conflict",
  "not-eligible",
  "already-due",
  "invalid-artifact",
  "unsupported-catalog",
  "arithmetic-bound",
  "public-read-only",
  "active-execution",
  "terminal-state",
  "investigation-required",
  "exhausted-budget",
  "unavailable",
  "limit-reached"
])
export type JobOperatorReason = typeof JobOperatorReason.Type
export const JobOperatorResult = Schema.Union([
  Schema.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: JobOperatorAction,
    sourceJobId: JobId,
    sourceState: JobState,
    sourceLifecycleVersion: Counter,
    resultJobId: JobId,
    resultState: JobState,
    resultLifecycleVersion: Counter,
    observedAt: EpochMillis
  }),
  Schema.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: JobOperatorAction,
    jobId: JobId,
    reason: JobOperatorReason
  }),
  Schema.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
])
export type JobOperatorResult = typeof JobOperatorResult.Type
export const matchesCommandResult = (
  command: JobOperatorCommand,
  result: JobOperatorResult
): boolean =>
  result.sandbox.sandboxId === command.sandbox.sandboxId &&
  result.sandbox.generation === command.sandbox.generation &&
  result.requestId === command.requestId &&
  (result._tag === "OutcomeUnknown" ||
    (result.action === command.action &&
      (result._tag === "Rejected"
        ? result.jobId === command.jobId
        : result.sourceJobId === command.jobId &&
          result.sourceState === command.expectedState &&
          result.sourceLifecycleVersion === command.expectedLifecycleVersion)))
export const JobOperatorReceiptRequest = Schema.Struct({
  sandbox: SandboxRef,
  requestId: RequestId
})
export type JobOperatorReceiptRequest = typeof JobOperatorReceiptRequest.Type
const eligibility = Schema.Struct({
  enabled: Schema.Boolean,
  reason: Schema.NullOr(JobOperatorReason)
})
export const JobOperatorEligibility = Schema.Struct({
  retryNow: eligibility,
  cancel: eligibility,
  redrive: eligibility
})
export type JobOperatorEligibility = typeof JobOperatorEligibility.Type

// Explicit fields produce a stable, complete immutable admission identity.
// The caller must decode strictly first. Never include client-selected producer data.
export const commandIdentity = (command: JobOperatorCommand): string =>
  JSON.stringify([
    command.sandbox.sandboxId,
    command.sandbox.generation,
    command.requestId,
    command.jobId,
    command.expectedState,
    command.expectedLifecycleVersion,
    command.action,
    command.action === "redrive" ? command.confirmDuplicateEffects : null
  ])

export class Operators extends Context.Service<
  Operators,
  {
    readonly execute: (
      access: SandboxAccess,
      command: JobOperatorCommand
    ) => Effect.Effect<JobOperatorResult, PlaygroundError>
    readonly receipt: (
      access: SandboxAccess,
      request: JobOperatorReceiptRequest
    ) => Effect.Effect<JobOperatorResult, PlaygroundError>
  }
>()("playground/Operators") {}
