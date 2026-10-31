/** Immutable, unvalidated retry descriptions; construction starts no timers. */
import { Duration, Pipeable } from "effect"
import * as Model from "./internal/policy/Retry.js"

const TypeId = "~effect-jobs/JobRetryPolicy"

/** A reusable unvalidated description; Policy.make supplies the typed validation boundary. */
export interface JobRetryPolicy extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly schedule: Model.RetryDescription
  readonly maxAttempts: number
}

class RetryPolicy extends Pipeable.Class implements JobRetryPolicy {
  readonly [TypeId] = TypeId
  constructor(
    readonly schedule: Model.RetryDescription,
    readonly maxAttempts: number
  ) {
    super()
    Object.freeze(schedule)
    Object.freeze(this)
  }
}

/** Fixed delay; defaults to at most three finalized attempts. */
export const fixed = (delay: Duration.Duration): JobRetryPolicy =>
  new RetryPolicy(
    Model.RetryDescription.Fixed({
      delayMillis: Model.durationMillis(delay),
      maxDelayMillis: undefined,
      jitter: "None"
    }),
    3
  )

/** Exponential delay, factor 2 by default; first retry uses the supplied base. */
export const exponential = (
  delay: Duration.Duration,
  options: { readonly factor?: number } = {}
): JobRetryPolicy =>
  new RetryPolicy(
    Model.RetryDescription.Exponential({
      delayMillis: Model.durationMillis(delay),
      factor: options.factor ?? 2,
      maxDelayMillis: undefined,
      jitter: "None"
    }),
    3
  )

/** Cap the base delay before jitter, regardless of combinator order. */
export const capped = (maxDelay: Duration.Duration) => {
  const maxDelayMillis = Model.durationMillis(maxDelay)
  return (self: JobRetryPolicy): JobRetryPolicy =>
    new RetryPolicy({ ...self.schedule, maxDelayMillis }, self.maxAttempts)
}

/** Integer jitter in 80–120% of nominal delay, with the range bounded by the hard cap. */
export const jittered =
  () =>
  (self: JobRetryPolicy): JobRetryPolicy =>
    new RetryPolicy({ ...self.schedule, jitter: "ProportionalV1" }, self.maxAttempts)

/** Maximum finalized attempts including the first, 1–100; 1 disables retries. */
export const maxAttempts =
  (count: number) =>
  (self: JobRetryPolicy): JobRetryPolicy =>
    new RetryPolicy(self.schedule, count)
