import { Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { SandboxRef } from "./Sandbox.js"

export type ScenarioId = typeof ScenarioId.Type
export const ScenarioId = Schema.Literals([
  "success",
  "delayed-success",
  "isolated",
  "retry-then-success",
  "terminal-failure",
  "unknown-outcome",
  "deduplication"
])
export const RequestId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))
)
export type ScenarioCommand = typeof ScenarioCommand.Type
export const ScenarioCommand = Schema.Struct({
  sandbox: SandboxRef,
  requestId: RequestId,
  scenario: ScenarioId,
  count: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 10 })))
})
// Acknowledged enqueue is not proof of handler success.
export type ScenarioResult = typeof ScenarioResult.Type
export const ScenarioResult = Schema.Union([
  Schema.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    jobIds: Schema.Array(JobId).pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10))
    )
  }),
  Schema.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
])
export type ResetCommand = typeof ResetCommand.Type
export const ResetCommand = Schema.Struct({ sandbox: SandboxRef, requestId: RequestId })
export type ResetResult = typeof ResetResult.Type
export const ResetResult = Schema.Union([
  Schema.TaggedStruct("Committed", {
    previous: SandboxRef,
    current: SandboxRef,
    requestId: RequestId
  }),
  Schema.TaggedStruct("OutcomeUnknown", { previous: SandboxRef, requestId: RequestId })
]).pipe(
  Schema.check(
    Schema.makeFilter(
      (result) =>
        result._tag === "OutcomeUnknown" ||
        (result.previous.sandboxId === result.current.sandboxId &&
          result.current.generation === result.previous.generation + 1)
    )
  )
)

export type ReceiptRequest = typeof ReceiptRequest.Type
export const ReceiptRequest = Schema.Struct({ sandbox: SandboxRef, requestId: RequestId })
