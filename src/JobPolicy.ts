import { Data, Duration, Schema } from "effect"

export const maximumMillis = 253_402_300_799_999
export const PositiveMillis = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: maximumMillis }))
)
/** Preserve the source's positive, bounded epoch-millisecond boundary. */
export const EpochMillis = PositiveMillis

export const JobRetention = Schema.Union([
  Schema.TaggedStruct("Forever", {}),
  Schema.TaggedStruct("Duration", { millis: PositiveMillis })
])
export type JobRetention = typeof JobRetention.Type

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
/** Complete version-1 durable representation; never resolve defaults while decoding storage. */
export const PersistedJobPolicy = PolicyStruct.pipe(
  Schema.check(Schema.makeFilter((p) => p.attemptTimeoutMillis < p.leaseDurationMillis))
)
export type JobPolicy = typeof PersistedJobPolicy.Type

export interface JobPolicyOptions {
  readonly leaseDuration?: Duration.Duration
  readonly attemptTimeout?: Duration.Duration
  readonly retryDelay?: Duration.Duration
  readonly maxAttempts?: number
  readonly maxStalledCount?: number
  readonly completedRetention?: Duration.Duration
  readonly deadRetention?: Duration.Duration
}

export class JobPolicyConfigurationError extends Data.TaggedError(
  "JobPolicyConfigurationError"
)<{
  readonly field: keyof JobPolicyOptions
  readonly expected: string
}> {}

const millis = (value: Duration.Duration, field: keyof JobPolicyOptions): number => {
  const n = Duration.toMillis(value)
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

/** Synchronous immutable configuration, like job and producer declarations. */
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
