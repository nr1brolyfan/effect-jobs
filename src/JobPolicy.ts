/**
 * Resolves immutable execution and retention policy for durable storage.
 */
import { Data, Duration, Schema } from "effect"

/**
 * Upper bound for persisted durations and positive epoch-millisecond timestamps.
 *
 * @category constants
 */
export const maximumMillis = 253_402_300_799_999
/**
 * Integer milliseconds in 1–253,402,300,799,999; no rounding or clamping.
 *
 * @category schemas
 */
export const PositiveMillis = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: maximumMillis }))
)
/**
 * Positive bounded epoch-millisecond Schema. Epoch zero is rejected; past positive
 * timestamps are valid and availability is not an execution deadline.
 *
 * @category schemas
 */
export const EpochMillis = PositiveMillis

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
 * Decoded value of the JobRetention Schema.
 *
 * @category models
 */
export type JobRetention = typeof JobRetention.Type

/**
 * Versioned persisted fixed-delay retry schedule; no exponential backoff.
 *
 * @category schemas
 */
export const FixedDelayV1 = Schema.TaggedStruct("FixedDelayV1", {
  delayMillis: PositiveMillis
})
const PolicyStruct = Schema.Struct({
  leaseDurationMillis: PositiveMillis,
  attemptTimeoutMillis: PositiveMillis,
  maxAttempts: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  ),
  maxStalledCount: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
  ),
  retrySchedule: FixedDelayV1,
  completedRetention: JobRetention,
  deadRetention: JobRetention
})
/**
 * Complete V1 policy Schema, requiring attemptTimeoutMillis < leaseDurationMillis.
 * Decoding stored policy never applies current deployment defaults.
 *
 * @category schemas
 */
export const PersistedJobPolicy = PolicyStruct.pipe(
  Schema.check(Schema.makeFilter((p) => p.attemptTimeoutMillis < p.leaseDurationMillis))
)
/**
 * Complete immutable policy resolved by make and validated by PersistedJobPolicy.
 *
 * @category models
 */
export type JobPolicy = typeof PersistedJobPolicy.Type

/**
 * Optional Duration-based configuration. Finite durations must be positive integer
 * milliseconds; only retention accepts Duration.infinity.
 *
 * @category models
 */
export interface JobPolicyOptions {
  /** Fixed non-renewable lease; defaults to 90 seconds. */
  readonly leaseDuration?: Duration.Duration
  /** Includes payload decoding and handler execution; defaults to 30 seconds, below leaseDuration. */
  readonly attemptTimeout?: Duration.Duration
  /** Persisted fixed delay after a finalized Retry; defaults to 5 seconds. */
  readonly retryDelay?: Duration.Duration
  /** Finalized attempts including the first: 1–100, default 3. */
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
  const n = Duration.match(value, {
    onMillis: (n) => n,
    onNanos: (nanos) =>
      nanos % 1_000_000n === 0n &&
      nanos > 0n &&
      nanos <= BigInt(maximumMillis) * 1_000_000n
        ? Number(nanos / 1_000_000n)
        : NaN,
    onInfinity: () => Infinity,
    onNegativeInfinity: () => -Infinity
  })
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
 *
 * const policy = Policy.make({
 *   maxAttempts: 3,
 *   retryDelay: Duration.seconds(5),
 *   completedRetention: Duration.days(90),
 *   deadRetention: Duration.infinity
 * })
 * ```
 *
 * @see {@link PersistedJobPolicy} for validation of stored complete policy
 * @category constructors
 */
export const make = (options: JobPolicyOptions = {}): JobPolicy => {
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
  const maxAttempts = options.maxAttempts ?? 3
  const maxStalledCount = options.maxStalledCount ?? 1
  if (!Schema.is(PolicyStruct.fields.maxAttempts)(maxAttempts)) {
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
    retrySchedule: Object.freeze({
      _tag: "FixedDelayV1",
      delayMillis: millis(options.retryDelay ?? Duration.seconds(5), "retryDelay")
    }),
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
