/**
 * Maps application handler failures to bounded durable execution outcomes.
 */
import { Data, Schema } from "effect"
import { EpochMillis } from "./JobPolicy.js"

import { FailureCode } from "./FailureCode.js"
export { FailureCode } from "./FailureCode.js"

/**
 * Explicit Retry, Dead, Isolate or OutcomeUnknown handler failure Schema/type.
 * Unknown does not prove the external effect failed and is not a durable state.
 *
 * @category schemas
 */
export const JobFailure = Schema.Union([
  Schema.TaggedStruct("Retry", {
    code: FailureCode,
    notAfter: Schema.optional(EpochMillis)
  }),
  Schema.TaggedStruct("Dead", { code: FailureCode }),
  Schema.TaggedStruct("Isolate", { code: FailureCode }),
  Schema.TaggedStruct("OutcomeUnknown", { code: FailureCode })
])
/**
 * Decoded value of the JobFailure Schema.
 *
 * @category models
 */
export type JobFailure = typeof JobFailure.Type
const failures = Data.taggedEnum<JobFailure>()

/**
 * Thrown synchronously by JobFailures for an invalid retry cutoff.
 *
 * @category errors
 */
export class InvalidJobFailure extends Data.TaggedError("InvalidJobFailure")<{
  readonly field: "notAfter"
}> {}
const checked = <A extends JobFailure>(value: A): A => {
  if (
    value._tag === "Retry" &&
    value.notAfter !== undefined &&
    !Schema.is(EpochMillis)(value.notAfter)
  ) {
    throw new InvalidJobFailure({ field: "notAfter" })
  }
  return Object.freeze(value)
}
/**
 * Frozen outcome factories taking validated codes; invalid retry cutoffs throw InvalidJobFailure.
 * Map domain errors with ordinary Effect composition before installing handlers.
 *
 * @category constructors
 */
export const JobFailures = Object.freeze({
  /** Persisted fixed-delay retry within attempt bounds; next availability >= notAfter becomes Dead. */
  Retry: (input: { readonly code: FailureCode; readonly notAfter?: number }) =>
    checked(failures.Retry(input)),
  /** Known terminal failure with no further retry. */
  Dead: (input: { readonly code: FailureCode }) => checked(failures.Dead(input)),
  /** Invalid artifact/invariant requiring investigation; never automatically purged. */
  Isolate: (input: { readonly code: FailureCode }) => checked(failures.Isolate(input)),
  /** External effects may have happened; leaves no confirmed finalization for bounded recovery. */
  OutcomeUnknown: (input: { readonly code: FailureCode }) =>
    checked(failures.OutcomeUnknown(input))
})
