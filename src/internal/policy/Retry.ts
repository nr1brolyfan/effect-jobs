import { Data, Duration, Schema } from "effect"

/** Unvalidated builder data. Only Policy.make resolves this into durable policy. */
export type RetryDescription = Data.TaggedEnum<{
  Fixed: {
    readonly delayMillis: number
    readonly maxDelayMillis: number | undefined
    readonly jitter: "None" | "ProportionalV1"
  }
  Exponential: {
    readonly delayMillis: number
    readonly factor: number
    readonly maxDelayMillis: number | undefined
    readonly jitter: "None" | "ProportionalV1"
  }
}>
export const RetryDescription = Data.taggedEnum<RetryDescription>()

// Validate the public description's shape once at effectful assembly. Numeric
// constraints remain separate so failures retain their exact option paths.
export const RetryInput = Schema.Struct({
  schedule: Schema.Struct({
    _tag: Schema.Literals(["Fixed", "Exponential"]),
    delayMillis: Schema.Unknown,
    maxDelayMillis: Schema.Unknown.pipe(Schema.optional),
    factor: Schema.Unknown.pipe(Schema.optional),
    jitter: Schema.Literals(["None", "ProportionalV1"])
  }),
  maxAttempts: Schema.Unknown
})

export const maximumMillis = 253_402_300_799_999
export const PositiveMillis = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: maximumMillis }))
)
export const AttemptLimit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
)
export const Factor = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(1))
)
export const JitterSample = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(1))
)
export const FixedDelayV1 = Schema.TaggedStruct("FixedDelayV1", {
  delayMillis: PositiveMillis
})
export const BackoffV1 = Schema.TaggedStruct("BackoffV1", {
  delayMillis: PositiveMillis,
  factor: Factor,
  maxDelayMillis: PositiveMillis,
  jitter: Schema.Literals(["None", "Full", "ProportionalV1"])
})
export type RetrySchedule = typeof RetrySchedule.Type
export const RetrySchedule = Schema.Union([FixedDelayV1, BackoffV1])

/** Exact conversion shared by duration-based policy constructors. */
export const durationMillis = (value: Duration.Duration): number =>
  !Duration.isDuration(value)
    ? NaN
    : Duration.match(value, {
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

/** Bounded integer delay after the one-based finalized attempt. */
export const delay = (
  schedule: RetrySchedule,
  attemptsMade: number,
  jitterSample: number | undefined
): number => {
  if (schedule._tag === "FixedDelayV1") {
    return schedule.delayMillis
  }
  // Saturate before multiplying: even a huge finite factor cannot overflow.
  let limit = Math.min(schedule.delayMillis, schedule.maxDelayMillis)
  for (let index = 1; index < attemptsMade && limit < schedule.maxDelayMillis; index++) {
    limit =
      limit >= schedule.maxDelayMillis / schedule.factor
        ? schedule.maxDelayMillis
        : limit * schedule.factor
  }
  limit = Math.floor(limit)
  if (schedule.jitter === "None") {
    return limit
  }
  // Full is the original stored algorithm. Never reinterpret existing rows.
  // Proportional bounds use exact integer arithmetic before sampling, not a
  // final clamp that would concentrate samples at the cap.
  const lower = schedule.jitter === "Full" ? 0 : Number((BigInt(limit) * 4n + 4n) / 5n)
  const upper =
    schedule.jitter === "Full"
      ? limit
      : Math.min(schedule.maxDelayMillis, Number((BigInt(limit) * 6n) / 5n))
  return lower + Math.min(upper - lower, Math.floor(jitterSample! * (upper - lower + 1)))
}
