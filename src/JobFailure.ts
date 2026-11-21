/**
 * Maps application handler failures to bounded durable execution outcomes.
 */
import { Data, Schema, type DateTime } from "effect"
import { JobInstant } from "./internal/Time.js"

import { FailureCode } from "./FailureCode.js"
export { FailureCode } from "./FailureCode.js"

/**
 * Decoded value of the JobFailure Schema.
 *
 * @category models
 */
export type JobFailure = typeof JobFailure.Type
/**
 * Explicit Retry, Dead, Isolate or OutcomeUnknown handler failure Schema/type.
 * Unknown does not prove the external effect failed and is not a durable state.
 *
 * @category schemas
 */
export const JobFailure = Schema.Union([
  Schema.TaggedStruct("Retry", {
    code: FailureCode,
    retryBefore: JobInstant.pipe(Schema.optional)
  }),
  Schema.TaggedStruct("Dead", { code: FailureCode }),
  Schema.TaggedStruct("Isolate", { code: FailureCode }),
  Schema.TaggedStruct("OutcomeUnknown", {})
])
const failures = Data.taggedEnum<JobFailure>()

/**
 * Thrown synchronously by JobFailures for an invalid retry cutoff.
 *
 * @category errors
 */
export class InvalidJobFailure extends Data.TaggedError("InvalidJobFailure")<{
  readonly field: "retryBefore"
}> {}
const checked = <A extends JobFailure>(value: A): A => {
  if (
    value._tag === "Retry" &&
    value.retryBefore !== undefined &&
    !Schema.is(JobInstant)(value.retryBefore)
  ) {
    throw new InvalidJobFailure({ field: "retryBefore" })
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
  /** Retry within policy bounds; next availability >= retryBefore becomes Dead.
   * This cutoff limits retry scheduling, not initial availability or handler execution. */
  Retry: (input: { readonly code: FailureCode; readonly retryBefore?: DateTime.Utc }) =>
    checked(failures.Retry(input)),
  /** Known terminal failure with no further retry. */
  Dead: (input: { readonly code: FailureCode }) => checked(failures.Dead(input)),
  /** Invalid artifact/invariant requiring investigation; never automatically purged. */
  Isolate: (input: { readonly code: FailureCode }) => checked(failures.Isolate(input)),
  /** External effects may have happened; leaves no confirmed finalization for bounded recovery. */
  OutcomeUnknown: () => checked(failures.OutcomeUnknown())
})
