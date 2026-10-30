/**
 * Resolves immutable execution and retention policy for durable storage.
 */
import { Data, Duration, Schema } from "effect"
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
 * Thrown synchronously with the invalid option field and expected constraint.
 *
 * @category errors
 */
export class JobPolicyConfigurationError extends Data.TaggedError(
  "JobPolicyConfigurationError"
)<{
  readonly field: keyof JobPolicyOptions
  readonly expected: string
}> {}

const millis = (value: Duration.Duration, field: keyof JobPolicyOptions): number => {
  const n = Retry.durationMillis(value)
  if (!Schema.is(PositiveMillis)(n)) {
    throw new JobPolicyConfigurationError({
      field,
      expected: `finite integer milliseconds in 1–${maximumMillis}`
    })
  }
  return n
}
const retention = (
  value: Duration.Duration,
  field: keyof JobPolicyOptions
): JobRetention =>
  Object.freeze(
    !Duration.isFinite(value) && Duration.toMillis(value) === Infinity
      ? { _tag: "Forever" }
      : { _tag: "Duration", millis: millis(value, field) }
  )

/**
 * Resolves and freezes policy, throwing JobPolicyConfigurationError for invalid input.
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
export const make = (options: JobPolicyOptions = {}): JobPolicy => {
  if (
    options.retry !== undefined &&
    (options.retryDelay !== undefined || options.maxAttempts !== undefined)
  ) {
    throw new JobPolicyConfigurationError({
      field: "retry",
      expected: "retry without legacy retryDelay or maxAttempts"
    })
  }
  const retry = options.retry
  if (retry !== undefined && !Schema.is(Retry.RetrySchedule)(retry.schedule)) {
    throw new JobPolicyConfigurationError({
      field: "retry",
      expected: "a complete valid JobRetryPolicy"
    })
  }
  const leaseDurationMillis = millis(
    options.leaseDuration ?? Duration.seconds(90),
    "leaseDuration"
  )
  const attemptTimeoutMillis = millis(
    options.attemptTimeout ?? Duration.seconds(30),
    "attemptTimeout"
  )
  if (attemptTimeoutMillis >= leaseDurationMillis) {
    throw new JobPolicyConfigurationError({
      field: "attemptTimeout",
      expected: "strictly less than leaseDuration"
    })
  }
  const maxAttempts = retry?.maxAttempts ?? options.maxAttempts ?? 3
  const maxStalledCount = options.maxStalledCount ?? 1
  if (!Schema.is(Retry.AttemptLimit)(maxAttempts)) {
    throw new JobPolicyConfigurationError({
      field: "maxAttempts",
      expected: "integer in 1–100"
    })
  }
  if (!Schema.is(PolicyStruct.fields.maxStalledCount)(maxStalledCount)) {
    throw new JobPolicyConfigurationError({
      field: "maxStalledCount",
      expected: "integer in 0–100"
    })
  }
  return Object.freeze({
    leaseDurationMillis,
    attemptTimeoutMillis,
    maxAttempts,
    maxStalledCount,
    retrySchedule: Object.freeze(
      retry === undefined
        ? {
            _tag: "FixedDelayV1",
            delayMillis: millis(options.retryDelay ?? Duration.seconds(5), "retryDelay")
          }
        : { ...retry.schedule }
    ),
    completedRetention: retention(
      options.completedRetention ?? Duration.days(90),
      "completedRetention"
    ),
    deadRetention: retention(options.deadRetention ?? Duration.infinity, "deadRetention")
  })
}

/** Deeply immutable shared policy with the same defaults as make().
 * Caller-owned options are never frozen or mutated.
 * @category constants
 */
export const defaultPolicy: JobPolicy = make()
