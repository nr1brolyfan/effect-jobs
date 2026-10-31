import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as JobPolicy from "../../src/JobPolicy.js"
import * as Retry from "../../src/JobRetryPolicy.js"

const configurationFailure = async (options: JobPolicy.JobPolicyOptions) => {
  // Neither constructing nor running invalid configuration may turn it into a defect.
  let effect: Effect.Effect<JobPolicy.JobPolicy, JobPolicy.JobPolicyConfigurationError>
  expect(() => {
    effect = JobPolicy.make(options)
  }).not.toThrow()
  const exit = await Effect.runPromiseExit(effect!)
  assert(Exit.isFailure(exit))
  expect(exit.cause.reasons).toHaveLength(1)
  const reason = exit.cause.reasons[0]!
  assert(Cause.isFailReason(reason))
  expect(reason.error).toBeInstanceOf(JobPolicy.JobPolicyConfigurationError)
  return reason.error
}

describe("complete immutable policy with typed validation", () => {
  it.each([
    0n,
    -1_000_000n,
    500_000n,
    31_536_000_000_000_001n,
    253_402_300_800_000_000_000n
  ])("rejects invalid nanoseconds before conversion loses precision", async (nanos) => {
    for (const field of [
      "leaseDuration",
      "attemptTimeout",
      "completedRetention",
      "deadRetention"
    ] as const) {
      expect((await configurationFailure({ [field]: Duration.nanos(nanos) })).field).toBe(
        field
      )
    }
  })
  it("accepts exact maximum nanoseconds without rounding integer milliseconds", async () => {
    const maximum = Duration.nanos(253_402_300_799_999_000_000n)
    const policy = await Effect.runPromise(
      JobPolicy.make({
        leaseDuration: maximum,
        attemptTimeout: Duration.nanos(1_000_000n),
        retry: Retry.fixed(maximum),
        completedRetention: maximum,
        deadRetention: maximum
      })
    )
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
  it("does not convert oversized finite nanoseconds into Forever retention", async () => {
    const tooLarge = Duration.nanos(10n ** 400n)
    expect(Duration.isFinite(tooLarge)).toBe(true)
    expect((await configurationFailure({ completedRetention: tooLarge })).field).toBe(
      "completedRetention"
    )
    expect((await configurationFailure({ deadRetention: tooLarge })).field).toBe(
      "deadRetention"
    )
  })
  it("resolves all defaults and keeps trusted defaultPolicy as plain immutable data", async () => {
    const policy = await Effect.runPromise(JobPolicy.make())
    expect(policy).toEqual({
      leaseDurationMillis: 90_000,
      attemptTimeoutMillis: 30_000,
      maxAttempts: 3,
      maxStalledCount: 1,
      retrySchedule: { _tag: "FixedDelayV1", delayMillis: 5_000 },
      completedRetention: { _tag: "Duration", millis: 90 * 86_400_000 },
      deadRetention: { _tag: "Forever" }
    })
    expect(JobPolicy.defaultPolicy).toEqual(policy)
    for (const complete of [policy, JobPolicy.defaultPolicy]) {
      expect(Schema.is(JobPolicy.PersistedJobPolicy)(complete)).toBe(true)
      for (const value of [
        complete,
        complete.retrySchedule,
        complete.completedRetention,
        complete.deadRetention
      ]) {
        expect(Object.isFrozen(value)).toBe(true)
      }
    }
  })
  it("accepts numeric edges without manual configuration tags", async () => {
    const policy = await Effect.runPromise(
      JobPolicy.make({
        leaseDuration: Duration.millis(JobPolicy.maximumMillis),
        attemptTimeout: Duration.millis(1),
        retry: Retry.fixed(Duration.millis(JobPolicy.maximumMillis)).pipe(
          Retry.maxAttempts(100)
        ),
        maxStalledCount: 0,
        completedRetention: Duration.infinity,
        deadRetention: Duration.millis(1)
      })
    )
    expect(policy.completedRetention).toEqual({ _tag: "Forever" })
    expect(policy.deadRetention).toEqual({ _tag: "Duration", millis: 1 })
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(policy)).toBe(true)
    expect(
      (
        await Effect.runPromise(
          JobPolicy.make({
            retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxAttempts(1)),
            maxStalledCount: 100
          })
        )
      ).maxAttempts
    ).toBe(1)
  })
  it.each([0, -1, 0.5, JobPolicy.maximumMillis + 1, Infinity, -Infinity])(
    "rejects invalid duration ranges and fractional milliseconds",
    async (n) => {
      for (const field of [
        "leaseDuration",
        "attemptTimeout",
        "completedRetention",
        "deadRetention"
      ] as const) {
        if (
          n === Infinity &&
          (field === "completedRetention" || field === "deadRetention")
        ) {
          continue
        }
        expect((await configurationFailure({ [field]: Duration.millis(n) })).field).toBe(
          field
        )
      }
    }
  )
  it.each([0, -1, 101, 1.5, NaN, Infinity])(
    "rejects attempt limits through Fail",
    async (maxAttempts) => {
      expect(
        (
          await configurationFailure({
            retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxAttempts(maxAttempts))
          })
        ).field
      ).toBe("retry.maxAttempts")
    }
  )
  it.each([-1, 101, 0.5, NaN, Infinity])(
    "rejects stall limits through Fail",
    async (maxStalledCount) => {
      expect((await configurationFailure({ maxStalledCount })).field).toBe(
        "maxStalledCount"
      )
    }
  )
  it("enforces the timeout/lease edge on public and persisted values", async () => {
    for (const n of [29_999, 30_000, 30_001]) {
      const options = {
        leaseDuration: Duration.millis(30_000),
        attemptTimeout: Duration.millis(n)
      }
      if (n < 30_000) {
        expect(
          (await Effect.runPromise(JobPolicy.make(options))).attemptTimeoutMillis
        ).toBe(n)
      } else {
        expect((await configurationFailure(options)).field).toBe("attemptTimeout")
      }
      expect(
        Schema.is(JobPolicy.PersistedJobPolicy)({
          ...JobPolicy.defaultPolicy,
          leaseDurationMillis: 30_000,
          attemptTimeoutMillis: n
        })
      ).toBe(n < 30_000)
    }
  })
  it("decodes complete persisted data without filling deployment defaults", () => {
    const { deadRetention: _dead, ...incomplete } = JobPolicy.defaultPolicy
    expect(Schema.is(JobPolicy.PersistedJobPolicy)(incomplete)).toBe(false)
    expect(
      Schema.is(JobPolicy.PersistedJobPolicy)({
        ...JobPolicy.defaultPolicy,
        retrySchedule: { _tag: "Exponential", delayMillis: 5_000 }
      })
    ).toBe(false)
    expect(
      Schema.decodeUnknownSync(JobPolicy.PersistedJobPolicy)(
        JSON.parse(JSON.stringify(JobPolicy.defaultPolicy))
      )
    ).toEqual(JobPolicy.defaultPolicy)
  })
  it("supports ordinary catchTags recovery from expected configuration failure", async () => {
    const field = await Effect.runPromise(
      JobPolicy.make({
        retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxAttempts(0))
      }).pipe(
        Effect.catchTags({
          JobPolicyConfigurationError: (error) => Effect.succeed(error.field)
        })
      )
    )
    expect(field).toBe("retry.maxAttempts")
  })
  it("reports malformed JavaScript duration inputs through Fail rather than throwing", async () => {
    for (const field of [
      "leaseDuration",
      "attemptTimeout",
      "completedRetention",
      "deadRetention"
    ] as const) {
      expect(
        (await configurationFailure({ [field]: 5000 as unknown as Duration.Duration }))
          .field
      ).toBe(field)
    }
  })
  it("rejects malformed JavaScript options objects through the typed channel", async () => {
    for (const input of [null, 5000, "invalid", []]) {
      expect(
        (await configurationFailure(input as unknown as JobPolicy.JobPolicyOptions)).field
      ).toBe("options")
    }
  })
  it("rejects unsupported option names instead of silently treating them as defaults", async () => {
    for (const input of [
      { retryDelay: Duration.seconds(5) },
      { maxAttempts: 3 },
      { typo: true }
    ]) {
      expect(
        (await configurationFailure(input as unknown as JobPolicy.JobPolicyOptions)).field
      ).toBe("options")
    }
  })
})
