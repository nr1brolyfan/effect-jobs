import { Duration, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as JobPolicy from "../../src/JobPolicy.js"

describe("complete immutable policy", () => {
  it.each([
    0n,
    -1_000_000n,
    500_000n,
    31_536_000_000_000_001n,
    253_402_300_800_000_000_000n
  ])("rejects invalid nanoseconds before conversion loses precision", (nanos) => {
    for (const field of [
      "leaseDuration",
      "attemptTimeout",
      "retryDelay",
      "completedRetention",
      "deadRetention"
    ] as const) {
      expect(() => JobPolicy.make({ [field]: Duration.nanos(nanos) })).toThrow(
        expect.objectContaining({ _tag: "JobPolicyConfigurationError", field })
      )
    }
  })
  it("accepts exact maximum nanoseconds without rounding integer milliseconds", () => {
    const maximum = Duration.nanos(253_402_300_799_999_000_000n)
    const policy = JobPolicy.make({
      leaseDuration: maximum,
      attemptTimeout: Duration.nanos(1_000_000n),
      retryDelay: maximum,
      completedRetention: maximum,
      deadRetention: maximum
    })
    expect(policy.leaseDurationMillis).toBe(JobPolicy.maximumMillis)
    expect(policy.attemptTimeoutMillis).toBe(1)
    expect(policy.retrySchedule.delayMillis).toBe(JobPolicy.maximumMillis)
    expect(policy.completedRetention).toEqual({
      _tag: "Duration",
      millis: JobPolicy.maximumMillis
    })
    expect(policy.deadRetention).toEqual(policy.completedRetention)
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(policy)).toBe(true)
  })
  it("does not convert finite oversized nanoseconds into Forever retention", () => {
    const tooLarge = Duration.nanos(10n ** 400n)
    expect(Duration.isFinite(tooLarge)).toBe(true)
    expect(() => JobPolicy.make({ completedRetention: tooLarge })).toThrow(
      JobPolicy.JobPolicyConfigurationError
    )
    expect(() => JobPolicy.make({ deadRetention: tooLarge })).toThrow(
      JobPolicy.JobPolicyConfigurationError
    )
  })
  it("resolves all accepted defaults including required durable retention", () => {
    const policy = JobPolicy.make()
    expect(policy).toEqual({
      leaseDurationMillis: 90_000,
      attemptTimeoutMillis: 30_000,
      maxAttempts: 3,
      maxStalledCount: 1,
      retrySchedule: { _tag: "FixedDelayV1", delayMillis: 5_000 },
      completedRetention: { _tag: "Duration", millis: 90 * 86_400_000 },
      deadRetention: { _tag: "Forever" }
    })
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(policy)).toBe(true)
    for (const value of [
      policy,
      policy.retrySchedule,
      policy.completedRetention,
      policy.deadRetention
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
  })
  it("accepts source numeric edges and resolves Duration inputs without manual tags", () => {
    const policy = JobPolicy.make({
      leaseDuration: Duration.millis(JobPolicy.maximumMillis),
      attemptTimeout: Duration.millis(1),
      retryDelay: Duration.millis(JobPolicy.maximumMillis),
      maxAttempts: 100,
      maxStalledCount: 0,
      completedRetention: Duration.infinity,
      deadRetention: Duration.millis(1)
    })
    expect(policy.completedRetention).toEqual({ _tag: "Forever" })
    expect(policy.deadRetention).toEqual({ _tag: "Duration", millis: 1 })
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(policy)).toBe(true)
    expect(JobPolicy.make({ maxAttempts: 1, maxStalledCount: 100 }).maxAttempts).toBe(1)
  })
  it.each([0, -1, 0.5, JobPolicy.maximumMillis + 1, Infinity, -Infinity])(
    "rejects invalid duration ranges and fractional milliseconds",
    (n) => {
      for (const field of [
        "leaseDuration",
        "attemptTimeout",
        "retryDelay",
        "completedRetention",
        "deadRetention"
      ] as const) {
        if (
          n === Infinity &&
          (field === "completedRetention" || field === "deadRetention")
        ) {
          continue
        }
        expect(() => JobPolicy.make({ [field]: Duration.millis(n) })).toThrow(
          JobPolicy.JobPolicyConfigurationError
        )
      }
    }
  )
  it.each([0, -1, 101, 1.5, NaN, Infinity])("rejects attempt limits", (maxAttempts) => {
    expect(() => JobPolicy.make({ maxAttempts })).toThrow(
      JobPolicy.JobPolicyConfigurationError
    )
  })
  it.each([-1, 101, 0.5, NaN, Infinity])("rejects stall limits", (maxStalledCount) => {
    expect(() => JobPolicy.make({ maxStalledCount })).toThrow(
      JobPolicy.JobPolicyConfigurationError
    )
  })
  it("enforces the strict timeout/lease edge on public and persisted values", () => {
    for (const n of [29_999, 30_000, 30_001]) {
      const options = {
        leaseDuration: Duration.millis(30_000),
        attemptTimeout: Duration.millis(n)
      }
      if (n < 30_000) {
        expect(JobPolicy.make(options).attemptTimeoutMillis).toBe(n)
      } else {
        expect(() => JobPolicy.make(options)).toThrow(
          JobPolicy.JobPolicyConfigurationError
        )
      }
      expect(
        Schema.is(JobPolicy.PersistedJobPolicy)({
          ...JobPolicy.make(),
          leaseDurationMillis: 30_000,
          attemptTimeoutMillis: n
        })
      ).toBe(n < 30_000)
    }
  })
  it("validates complete persisted data without filling defaults", () => {
    const { deadRetention: _dead, ...incomplete } = JobPolicy.make()
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(incomplete)).toBe(false)
    expect(
      Schema.is(JobPolicy.PersistedJobPolicy)({
        ...JobPolicy.make(),
        retrySchedule: { _tag: "Exponential", delayMillis: 5_000 }
      })
    ).toBe(false)
    const decoded = Schema.decodeUnknownSync(JobPolicy.PersistedJobPolicy)(
      JSON.parse(JSON.stringify(JobPolicy.make()))
    )
    expect(decoded).toEqual(JobPolicy.make())
  })
})
