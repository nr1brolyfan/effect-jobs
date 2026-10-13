import { Data, Schema } from "effect"
import { EpochMillis } from "./JobPolicy.js"

export const FailureCode = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
    Schema.isPattern(/^[a-z0-9][a-z0-9_-]*$/u)
  )
)
export const JobFailure = Schema.Union([
  Schema.TaggedStruct("Retry", {
    code: FailureCode,
    notAfter: Schema.optional(EpochMillis)
  }),
  Schema.TaggedStruct("Dead", { code: FailureCode }),
  Schema.TaggedStruct("Isolate", { code: FailureCode }),
  Schema.TaggedStruct("OutcomeUnknown", { code: FailureCode })
])
export type JobFailure = typeof JobFailure.Type
const failures = Data.taggedEnum<JobFailure>()

export class InvalidJobFailure extends Data.TaggedError("InvalidJobFailure")<{
  readonly field: "code" | "notAfter"
}> {}
const checked = <A extends JobFailure>(value: A): A => {
  if (!Schema.is(FailureCode)(value.code)) {
    throw new InvalidJobFailure({ field: "code" })
  }
  if (
    value._tag === "Retry" &&
    value.notAfter !== undefined &&
    !Schema.is(EpochMillis)(value.notAfter)
  ) {
    throw new InvalidJobFailure({ field: "notAfter" })
  }
  return Object.freeze(value)
}
/** Explicit outcomes, not error-message or Cause persistence. */
export const JobFailures = Object.freeze({
  Retry: (input: { readonly code: string; readonly notAfter?: number }) =>
    checked(failures.Retry(input)),
  Dead: (input: { readonly code: string }) => checked(failures.Dead(input)),
  Isolate: (input: { readonly code: string }) => checked(failures.Isolate(input)),
  OutcomeUnknown: (input: { readonly code: string }) =>
    checked(failures.OutcomeUnknown(input))
})
