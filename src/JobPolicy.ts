/**
 * Resolves immutable execution and retention policy for durable storage.
 */
import { Data, Duration, Effect, Schema } from "effect"
import type { JobRetryPolicy } from "./JobRetryPolicy.js"
import * as Retry from "./internal/policy/Retry.js"

/**
 * Upper bound for persisted durations and positive epoch-millisecond timestamps.
 *
 * @category constants
 */
export const maximumMillis = Retry.maximumMillis
/**
 * Integer milliseconds in 1–253,402,300,799,999; no rounding or clamping.
 *
 * @category schemas
 */
export const PositiveMillis = Retry.PositiveMillis
/**
 * Positive bounded epoch-millisecond Schema. Epoch zero is rejected; past positive
 * timestamps are valid and availability is not an execution deadline.
 *
 * @category schemas
 */
export const EpochMillis = PositiveMillis

/**
 * Decoded value of the JobRetention Schema.
 *
 * @category models
 */
export type JobRetention = typeof JobRetention.Type
/**
 * Persisted Forever or finite Duration retention, measured from terminal completion.
 *
 * @category schemas
 */
export const JobRetention = Schema.Union([
  Schema.TaggedStruct("Forever", {}),
  Schema.TaggedStruct("Duration", { millis: PositiveMillis })
])

/**
 * Versioned persisted fixed-delay retry schedule; no exponential backoff.
 *
 * @category schemas
 */
export const FixedDelayV1 = Retry.FixedDelayV1
const PolicyStruct = Schema.Struct({
  leaseDurationMillis: PositiveMillis,
  attemptTimeoutMillis: PositiveMillis,
  maxAttempts: Retry.AttemptLimit,
  maxStalledCount: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
  ),
  retrySchedule: Retry.RetrySchedule,
  completedRetention: JobRetention,
  deadRetention: JobRetention
})
const OptionsObject = Schema.ObjectKeyword.pipe(
  Schema.check(Schema.makeFilter((value) => !Array.isArray(value)))
)
/**
 * Complete immutable policy resolved by make and validated by PersistedJobPolicy.
 *
 * @category models
 */
export type JobPolicy = typeof PersistedJobPolicy.Type
/**
 * Complete persisted policy Schema, requiring attemptTimeoutMillis < leaseDurationMillis.
 * Decoding stored policy never applies current deployment defaults.
 *
 * @category schemas
 */
export const PersistedJobPolicy = PolicyStruct.pipe(
  Schema.check(Schema.makeFilter((p) => p.attemptTimeoutMillis < p.leaseDurationMillis))
)

/**
 * Optional Duration-based configuration. Finite durations must be positive integer
 * milliseconds; only retention accepts Duration.infinity.
 *
 * @category models
 */
export interface JobPolicyOptions {
  /** Composable retry policy; omit for a fixed 5-second delay and three attempts. */
  readonly retry?: JobRetryPolicy
  /** Fixed non-renewable lease; defaults to 90 seconds. */
  readonly leaseDuration?: Duration.Duration
  /** Includes payload decoding and handler execution; defaults to 30 seconds, below leaseDuration. */
  readonly attemptTimeout?: Duration.Duration
  /** @deprecated Use retry: Retry.fixed(duration). Cannot be combined with retry. */
  readonly retryDelay?: Duration.Duration
  /** @deprecated Use Retry.maxAttempts(n). Cannot be combined with retry. */
  readonly maxAttempts?: number
  /** Permitted uncertain lease recoveries: 0–100, default 1. */
  readonly maxStalledCount?: number
  /** From Completed timestamp; defaults to 90 days. Deletion removes deduplication evidence. */
  readonly completedRetention?: Duration.Duration
  /** From Dead timestamp; defaults to Duration.infinity. Isolated jobs are never auto-purged. */
  readonly deadRetention?: Duration.Duration
}

/**
 * Expected validation failure in make's typed error channel; supplied values are not echoed.
 *
 * @category errors
 */
export class JobPolicyConfigurationError extends Data.TaggedError(
  "JobPolicyConfigurationError"
)<{
  readonly field: JobPolicyConfigurationField
  readonly expected: string
}> {}

/** Exact option path reported for invalid public configuration. */
export type JobPolicyConfigurationField =
  | keyof JobPolicyOptions
  | "options"
  | "retry.delay"
  | "retry.factor"
  | "retry.maxDelay"
  | "retry.maxAttempts"

const positive = Effect.fnUntraced(function* (
  n: number,
  field: JobPolicyConfigurationField
) {
  if (!Schema.is(PositiveMillis)(n)) {
    return yield* new JobPolicyConfigurationError({
      field,
      expected: `finite integer milliseconds in 1–${maximumMillis}`
    })
  }
  return n
})
const millis = (value: Duration.Duration, field: JobPolicyConfigurationField) =>
  positive(Retry.durationMillis(value), field)

const retention = Effect.fnUntraced(function* (
  value: Duration.Duration,
  field: JobPolicyConfigurationField
): Effect.fn.Return<JobRetention, JobPolicyConfigurationError> {
  return Object.freeze(
    Duration.isDuration(value) &&
      !Duration.isFinite(value) &&
      Duration.toMillis(value) === Infinity
      ? { _tag: "Forever" }
      : { _tag: "Duration", millis: yield* millis(value, field) }
  )
})

const retrySchedule = Effect.fnUntraced(function* (
  retry: JobRetryPolicy
): Effect.fn.Return<Retry.RetrySchedule, JobPolicyConfigurationError> {
  const description = retry.schedule
  const delayMillis = yield* positive(description.delayMillis, "retry.delay")
  const maxDelayMillis = yield* positive(
    description.maxDelayMillis ?? maximumMillis,
    "retry.maxDelay"
  )
  const factor = description._tag === "Fixed" ? 1 : description.factor
  if (
    description._tag === "Exponential" &&
    (!Schema.is(Retry.Factor)(factor) || factor === 1)
  ) {
    return yield* new JobPolicyConfigurationError({
      field: "retry.factor",
      expected: "finite number greater than 1"
    })
  }
  return Object.freeze(
    description._tag === "Fixed" &&
      description.maxDelayMillis === undefined &&
      description.jitter === "None"
      ? Retry.FixedDelayV1.make({ delayMillis })
      : Retry.BackoffV1.make({
          delayMillis,
          factor,
          maxDelayMillis,
          jitter: description.jitter
        })
  )
})

/**
 * Lazily validates and freezes complete policy; expected errors stay in the Effect channel.
 * Defaults: 90s fixed lease, 30s attempt timeout, 5s retry delay, 3 finalized attempts,
 * 1 stalled recovery, 90d Completed retention and Forever Dead retention.
 * Timeout must be strictly shorter than the lease. Unknown outcomes can repeat an
 * attempt number; maxAttempts does not bound every handler invocation.
 *
 * @example
 * ```ts
 * import { Duration } from "effect"
 * import * as Policy from "effect-jobs/JobPolicy"
 * import * as Retry from "effect-jobs/JobRetryPolicy"
 *
 * const policy = Policy.make({
 *   retry: Retry.exponential(Duration.seconds(1)).pipe(
 *     Retry.capped(Duration.minutes(1)),
 *     Retry.jittered(),
 *     Retry.maxAttempts(5)
 *   ),
 *   completedRetention: Duration.days(90),
 *   deadRetention: Duration.infinity
 * })
 * ```
 *
 * @see {@link PersistedJobPolicy} for validation of stored complete policy
 * @category constructors
 */
export const make = Effect.fnUntraced(function* (
  options: JobPolicyOptions = {}
): Effect.fn.Return<JobPolicy, JobPolicyConfigurationError> {
  if (!Schema.is(OptionsObject)(options)) {
    return yield* new JobPolicyConfigurationError({
      field: "options",
      expected: "an options object"
    })
  }
  if (
    options.retry !== undefined &&
    (options.retryDelay !== undefined || options.maxAttempts !== undefined)
  ) {
    return yield* new JobPolicyConfigurationError({
      field: "retry",
      expected: "retry without legacy retryDelay or maxAttempts"
    })
  }
  const retry = options.retry
  if (retry !== undefined && !Schema.is(Retry.RetryInput)(retry)) {
    return yield* new JobPolicyConfigurationError({
      field: "retry",
      expected: "a retry description built by JobRetryPolicy"
    })
  }
  const leaseDurationMillis = yield* millis(
    options.leaseDuration ?? Duration.seconds(90),
    "leaseDuration"
  )
  const attemptTimeoutMillis = yield* millis(
    options.attemptTimeout ?? Duration.seconds(30),
    "attemptTimeout"
  )
  if (attemptTimeoutMillis >= leaseDurationMillis) {
    return yield* new JobPolicyConfigurationError({
      field: "attemptTimeout",
      expected: "strictly less than leaseDuration"
    })
  }
  const maxAttempts = retry === undefined ? (options.maxAttempts ?? 3) : retry.maxAttempts
  const maxStalledCount = options.maxStalledCount ?? 1
  if (!Schema.is(Retry.AttemptLimit)(maxAttempts)) {
    return yield* new JobPolicyConfigurationError({
      field: retry === undefined ? "maxAttempts" : "retry.maxAttempts",
      expected: "integer in 1–100"
    })
  }
  if (!Schema.is(PolicyStruct.fields.maxStalledCount)(maxStalledCount)) {
    return yield* new JobPolicyConfigurationError({
      field: "maxStalledCount",
      expected: "integer in 0–100"
    })
  }
  return Object.freeze({
    leaseDurationMillis,
    attemptTimeoutMillis,
    maxAttempts,
    maxStalledCount,
    retrySchedule:
      retry === undefined
        ? Object.freeze(
            Retry.FixedDelayV1.make({
              delayMillis: yield* millis(
                options.retryDelay ?? Duration.seconds(5),
                "retryDelay"
              )
            })
          )
        : yield* retrySchedule(retry),
    completedRetention: yield* retention(
      options.completedRetention ?? Duration.days(90),
      "completedRetention"
    ),
    deadRetention: yield* retention(
      options.deadRetention ?? Duration.infinity,
      "deadRetention"
    )
  })
})

/** Deeply immutable shared policy with the same defaults as make().
 * Caller-owned options are never frozen or mutated.
 * @category constants
 */
export const defaultPolicy: JobPolicy = Object.freeze({
  leaseDurationMillis: 90_000,
  attemptTimeoutMillis: 30_000,
  maxAttempts: 3,
  maxStalledCount: 1,
  retrySchedule: Object.freeze(Retry.FixedDelayV1.make({ delayMillis: 5_000 })),
  completedRetention: Object.freeze({ _tag: "Duration", millis: 90 * 86_400_000 }),
  deadRetention: Object.freeze({ _tag: "Forever" })
})
