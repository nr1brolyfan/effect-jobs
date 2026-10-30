/** Immutable, serializable retry descriptions; construction starts no timers. */
import { Data, Duration, Pipeable, Schema } from "effect"
import * as Model from "./internal/policy/Retry.js"

const TypeId = "~effect-jobs/JobRetryPolicy"

/** A reusable retry description. Limits include the first finalized attempt. */
export interface JobRetryPolicy extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly schedule: Model.RetrySchedule
  readonly maxAttempts: number
}

/** Invalid public retry configuration; no supplied values are echoed. */
export class JobRetryPolicyConfigurationError extends Data.TaggedError(
  "JobRetryPolicyConfigurationError"
)<{
  readonly field: "delay" | "factor" | "maxDelay" | "maxAttempts"
  readonly expected: string
}> {}

class RetryPolicy extends Pipeable.Class implements JobRetryPolicy {
  readonly [TypeId] = TypeId
  constructor(
    readonly schedule: Model.RetrySchedule,
    readonly maxAttempts: number
  ) {
    super()
    Object.freeze(schedule)
    Object.freeze(this)
  }
}

const millis = (value: Duration.Duration, field: "delay" | "maxDelay") => {
  const n = Model.durationMillis(value)
  if (!Schema.is(Model.PositiveMillis)(n)) {
    throw new JobRetryPolicyConfigurationError({
      field,
      expected: `finite integer milliseconds in 1–${Model.maximumMillis}`
    })
  }
  return n
}

/** Fixed delay; defaults to at most three finalized attempts. */
export const fixed = (delay: Duration.Duration): JobRetryPolicy =>
  new RetryPolicy(Model.FixedDelayV1.make({ delayMillis: millis(delay, "delay") }), 3)

/** Exponential delay, factor 2 by default; first retry uses the supplied base. */
export const exponential = (
  delay: Duration.Duration,
  options: { readonly factor?: number } = {}
): JobRetryPolicy => {
  const factor = options.factor ?? 2
  if (!Schema.is(Model.Factor)(factor) || factor === 1) {
    throw new JobRetryPolicyConfigurationError({
      field: "factor",
      expected: "finite number greater than 1"
    })
  }
  return new RetryPolicy(
    Model.BackoffV1.make({
      delayMillis: millis(delay, "delay"),
      factor,
      maxDelayMillis: Model.maximumMillis,
      jitter: "None"
    }),
    3
  )
}

const backoff = (self: JobRetryPolicy) =>
  self.schedule._tag === "BackoffV1"
    ? self.schedule
    : Model.BackoffV1.make({
        delayMillis: self.schedule.delayMillis,
        factor: 1,
        maxDelayMillis: Model.maximumMillis,
        jitter: "None"
      })

/** Cap the base delay before jitter, regardless of combinator order. */
export const capped = (maxDelay: Duration.Duration) => {
  const maxDelayMillis = millis(maxDelay, "maxDelay")
  return (self: JobRetryPolicy): JobRetryPolicy =>
    new RetryPolicy({ ...backoff(self), maxDelayMillis }, self.maxAttempts)
}

/** Full jitter: an integer delay from zero through the capped delay, inclusive. */
export const jittered =
  () =>
  (self: JobRetryPolicy): JobRetryPolicy =>
    new RetryPolicy({ ...backoff(self), jitter: "Full" }, self.maxAttempts)

/** Maximum finalized attempts including the first, 1–100; 1 disables retries. */
export const maxAttempts = (count: number) => {
  if (!Schema.is(Model.AttemptLimit)(count)) {
    throw new JobRetryPolicyConfigurationError({
      field: "maxAttempts",
      expected: "integer in 1–100"
    })
  }
  return (self: JobRetryPolicy): JobRetryPolicy => new RetryPolicy(self.schedule, count)
}
