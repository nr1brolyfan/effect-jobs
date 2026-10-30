import { Duration, Schema } from "effect"

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
  jitter: Schema.Literals(["None", "Full"])
})
export type RetrySchedule = typeof RetrySchedule.Type
export const RetrySchedule = Schema.Union([FixedDelayV1, BackoffV1])

/** Exact conversion shared by duration-based policy constructors. */
export const durationMillis = (value: Duration.Duration): number =>
  Duration.match(value, {
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
  return schedule.jitter === "Full"
    ? Math.min(limit, Math.floor(jitterSample! * (limit + 1)))
    : limit
}
