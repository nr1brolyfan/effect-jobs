import { Context, Effect, Result, Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { Counter } from "effect-jobs/JobLifecycle"
import { EpochMillis } from "effect-jobs/JobPolicy"
import { SandboxRef, type SandboxAccess } from "./Sandbox.js"
import { RequestId } from "./Scenarios.js"
import { JobOperatorReason } from "./Operators.js"
import { PlaygroundError } from "./Services.js"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
const scalars = (value: string) =>
  Array.from(value).every(
    (scalar) => scalar.codePointAt(0)! < 0xd800 || scalar.codePointAt(0)! > 0xdfff
  )
const canonicalJson = (input: unknown, maximum = 65536): Result.Result<string, void> => {
  // Scratch belongs to one synchronous validation. Only foreign object operations
  // can throw; expected bounds/shape failures return through Result.
  try {
    const seen = new Set<object>()
    let length = 0
    const emit = (text: string): Result.Result<string, void> => {
      length += new TextEncoder().encode(text).length
      return length > maximum ? Result.failVoid : Result.succeed(text)
    }
    const quote = (text: string): Result.Result<string, void> =>
      text.length > maximum || !scalars(text)
        ? Result.failVoid
        : emit(JSON.stringify(text))
    const visit = (value: unknown, depth: number): Result.Result<string, void> =>
      Result.gen(function* () {
        if (depth > 32) {
          return yield* Result.failVoid
        }
        if (value === null) {
          return yield* emit("null")
        }
        if (typeof value === "boolean") {
          return yield* emit(String(value))
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return yield* emit(JSON.stringify(value))
        }
        if (typeof value === "string") {
          return yield* quote(value)
        }
        if (typeof value !== "object" || seen.has(value)) {
          return yield* Result.failVoid
        }
        const array = Array.isArray(value)
        if (
          !array &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        ) {
          return yield* Result.failVoid
        }
        seen.add(value)
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const keys = Reflect.ownKeys(descriptors)
        for (const key of keys) {
          if (array && key === "length") {
            continue
          }
          const descriptor = descriptors[key as string]!
          if (
            typeof key !== "string" ||
            !scalars(key) ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            return yield* Result.failVoid
          }
        }
        const entries: string[] = []
        if (array) {
          if (keys.length !== value.length + 1) {
            return yield* Result.failVoid
          }
          yield* emit("[]")
          for (let index = 0; index < value.length; index++) {
            if (index > 0) {
              yield* emit(",")
            }
            const descriptor = descriptors[String(index)]
            if (!descriptor) {
              return yield* Result.failVoid
            }
            entries.push(yield* visit(descriptor.value, depth + 1))
          }
        } else {
          yield* emit("{}")
          for (const [index, key] of (keys as string[]).sort().entries()) {
            if (index > 0) {
              yield* emit(",")
            }
            const name = yield* quote(key)
            yield* emit(":")
            const member = yield* visit(descriptors[key]!.value, depth + 1)
            entries.push(`${name}:${member}`)
          }
        }
        seen.delete(value)
        return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`
      })
    return visit(input, 0)
  } catch {
    // Proxies and native reflection/encoding are unsafe JavaScript boundaries.
    return Result.failVoid
  }
}

// Reject before recursive Schema traversal without invoking getters or coercion.
export const JsonValue = Schema.declare<JsonValue>((input): input is JsonValue =>
  Result.isSuccess(canonicalJson(input))
)
export type Reason = typeof Reason.Type
export const Reason = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        value.length >= 1 &&
        value.length <= 512 &&
        value.trim().length > 0 &&
        !value.includes("\0") &&
        new TextEncoder().encode(value).length <= 1024
    )
  )
)
export type JobResolutionState = typeof JobResolutionState.Type
export const JobResolutionState = Schema.Literals(["Open", "InProgress", "Resolved"])
export type JobProblem = typeof JobProblem.Type
export const JobProblem = Schema.Struct({
  rootJobId: JobId,
  state: JobResolutionState,
  version: Counter,
  updatedAt: EpochMillis,
  activeSuccessorJobId: JobId.pipe(Schema.NullOr),
  outcomeKnowledge: Schema.Literals(["KnownFailure", "Unknown"]),
  resolution: Schema.Struct({
    kind: Schema.Literals(["SuccessorCompleted", "OperatorReconciled", "ManualClose"]),
    reason: Reason.pipe(Schema.NullOr),
    observedAt: EpochMillis,
    successorJobId: JobId.pipe(Schema.NullOr)
  }).pipe(Schema.NullOr)
})
export type JobRepairReason = typeof JobRepairReason.Type
export const JobRepairReason = Schema.Literals([
  ...JobOperatorReason.literals,
  "invalid-payload",
  "resolution-conflict",
  "repair-in-progress",
  "already-resolved",
  "request-conflict",
  "encrypted-correction-unavailable",
  "lineage-conflict"
])
export type Investigation = typeof Investigation.Type
export const Investigation = Schema.Union([
  Schema.TaggedStruct("KnownFailure", {}),
  Schema.TaggedStruct("ConfirmedNotApplied", { reason: Reason }),
  Schema.TaggedStruct("AcceptDuplicateRisk", { reason: Reason }),
  Schema.TaggedStruct("Unconfirmed", {})
])
const guard = {
  sandbox: SandboxRef,
  requestId: RequestId,
  jobId: JobId,
  expectedState: Schema.Literals(["Dead", "Isolated"]),
  expectedLifecycleVersion: Counter,
  expectedResolutionVersion: Counter,
  reason: Reason,
  confirmDuplicateEffects: Schema.Literal(true),
  investigation: Investigation
}
export type JobRepairCommand = typeof JobRepairCommand.Type
export const JobRepairCommand = Schema.Union([
  Schema.Struct({ ...guard, action: Schema.Literal("redrive") }),
  Schema.Struct({
    ...guard,
    action: Schema.Literal("corrected-redrive"),
    payload: JsonValue
  })
])
export type JobRepairReceiptRequest = typeof JobRepairReceiptRequest.Type
export const JobRepairReceiptRequest = Schema.Struct({
  sandbox: SandboxRef,
  requestId: RequestId
})
export type JobRepairResult = typeof JobRepairResult.Type
export const JobRepairResult = Schema.Union([
  Schema.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: Schema.Literals(["redrive", "corrected-redrive"]),
    sourceJobId: JobId,
    sourceState: Schema.Literals(["Dead", "Isolated"]),
    sourceLifecycleVersion: Counter,
    resultJobId: JobId,
    observedAt: EpochMillis,
    problem: JobProblem
  }),
  Schema.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    jobId: JobId,
    reason: JobRepairReason
  }),
  Schema.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
])
export type JobResolutionCommand = typeof JobResolutionCommand.Type
export const JobResolutionCommand = Schema.Struct({
  sandbox: SandboxRef,
  requestId: RequestId,
  rootJobId: JobId,
  expectedResolutionVersion: Counter,
  reason: Reason,
  action: Schema.Literals(["reconcile-applied", "manual-close"]),
  confirmUnknownOutcome: Schema.Literal(true).pipe(Schema.optional)
})
export type JobResolutionResult = typeof JobResolutionResult.Type
export const JobResolutionResult = Schema.Union([
  Schema.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    problem: JobProblem,
    observedAt: EpochMillis
  }),
  Schema.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    rootJobId: JobId,
    reason: JobRepairReason
  }),
  Schema.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
])
export class Repairs extends Context.Service<
  Repairs,
  {
    readonly execute: (
      access: SandboxAccess,
      command: JobRepairCommand
    ) => Effect.Effect<JobRepairResult, PlaygroundError>
    readonly receipt: (
      access: SandboxAccess,
      request: JobRepairReceiptRequest
    ) => Effect.Effect<JobRepairResult, PlaygroundError>
    readonly resolve: (
      access: SandboxAccess,
      command: JobResolutionCommand
    ) => Effect.Effect<JobResolutionResult, PlaygroundError>
    readonly resolutionReceipt: (
      access: SandboxAccess,
      request: JobRepairReceiptRequest
    ) => Effect.Effect<JobResolutionResult, PlaygroundError>
  }
>()("playground/Repairs") {}
