import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Retry from "../../src/JobRetryPolicy.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Lifecycle from "../../src/JobLifecycle.js"
import * as Codes from "../../src/FailureCode.js"
import * as Reconciliation from "../../src/internal/lifecycle/Reconciliation.js"
import * as Delay from "../../src/internal/policy/Retry.js"
import { active, now, ownership, pending, token } from "./lifecycle/fixtures.js"

const code = Codes.define({ temporary: "temporary" }).temporary
const value = Result.getOrThrow
// Pure lifecycle fixtures use explicit synchronous evaluation of known-valid setup.
// Expected validation errors below are inspected through Exit, never runSync/toThrow.
const resolved = (retry: Retry.JobRetryPolicy) => Effect.runSync(Policy.make({ retry }))
const afterPolicy = (policy: Policy.JobPolicy, attemptsMade = 0, sample?: number) => {
  const row = active({ policy, attemptsMade })
  return value(
    Lifecycle.finalize(
      row,
      ownership(row),
      Lifecycle.JobFinalizations.Retry({
        code,
        ...(sample === undefined ? {} : { jitterSample: sample })
      }),
      now
    )
  )
}
const after = (retry: Retry.JobRetryPolicy, attemptsMade = 0, sample?: number) =>
  afterPolicy(resolved(retry), attemptsMade, sample)
const configurationFailure = async (options: Policy.JobPolicyOptions) => {
  const effect = Policy.make(options)
  const exit = await Effect.runPromiseExit(effect)
  assert(Exit.isFailure(exit))
  expect(exit.cause.reasons).toHaveLength(1)
  const reason = exit.cause.reasons[0]!
  assert(Cause.isFailReason(reason))
  expect(reason.error).toBeInstanceOf(Policy.JobPolicyConfigurationError)
  return reason.error
}

describe("pure retry descriptions and typed policy assembly", () => {
  it("keeps builders immutable and resolves to versioned serializable data", async () => {
    const fixed = Retry.fixed(Duration.seconds(5))
    expect(resolved(fixed)).toEqual(Policy.defaultPolicy)
    const retry = Retry.exponential(Duration.seconds(1)).pipe(
      Retry.capped(Duration.minutes(1)),
      Retry.jittered(),
      Retry.maxAttempts(5)
    )
    const policy = await Effect.runPromise(Policy.make({ retry }))
    expect(policy.maxAttempts).toBe(5)
    expect(policy.retrySchedule).toEqual({
      _tag: "BackoffV1",
      delayMillis: 1000,
      factor: 2,
      maxDelayMillis: 60000,
      jitter: "ProportionalV1"
    })
    for (const item of [
      fixed,
      fixed.schedule,
      retry,
      retry.schedule,
      policy,
      policy.retrySchedule
    ]) {
      expect(Object.isFrozen(item)).toBe(true)
    }
    expect(fixed.maxAttempts).toBe(3)
    expect(retry.pipe(Retry.maxAttempts(10)).maxAttempts).toBe(10)
    expect(retry.maxAttempts).toBe(5)
    expect(
      Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(
        JSON.parse(JSON.stringify(policy))
      )
    ).toEqual(policy)
    expect(Schema.is(Policy.PersistedJobPolicy)(retry)).toBe(false)
  })

  it("uses the final description, not intermediate overwritten settings", async () => {
    let retry!: Retry.JobRetryPolicy
    expect(() => {
      retry = Retry.fixed(Duration.seconds(1)).pipe(
        Retry.maxAttempts(0),
        Retry.maxAttempts(5),
        Retry.capped(Duration.millis(-1)),
        Retry.capped(Duration.seconds(2))
      )
    }).not.toThrow()
    expect((await Effect.runPromise(Policy.make({ retry }))).maxAttempts).toBe(5)
  })

  it("progresses from the first retry and caps before sampling regardless of combinator order", () => {
    const retry = Retry.exponential(Duration.millis(3)).pipe(
      Retry.capped(Duration.millis(10)),
      Retry.maxAttempts(10)
    )
    expect([0, 1, 2, 3, 4].map((n) => after(retry, n).availableAt - now)).toEqual([
      3, 6, 10, 10, 10
    ])
    const left = retry.pipe(Retry.jittered(), Retry.capped(Duration.millis(5)))
    const right = retry.pipe(Retry.capped(Duration.millis(5)), Retry.jittered())
    expect(resolved(left)).toEqual(resolved(right))
    expect(after(left, 3, 0).availableAt).toBe(now + 4)
    expect(after(left, 3, 0.5).availableAt).toBe(now + 5)
    expect(after(left, 3, 1 - Number.EPSILON).availableAt).toBe(now + 5)
    const reloaded = Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(
      JSON.parse(JSON.stringify(resolved(left)))
    )
    expect(afterPolicy(reloaded, 3, 0.5).availableAt).toBe(now + 5)
  })

  it("samples uniformly inside 80–120%, with a hard cap and no mass clamped onto it", () => {
    const retry = Retry.exponential(Duration.seconds(1)).pipe(Retry.jittered())
    expect(
      [0, 0.5, 1 - Number.EPSILON].map((u) => after(retry, 0, u).availableAt - now)
    ).toEqual([800, 1000, 1200])
    const capped = retry.pipe(Retry.capped(Duration.seconds(1)))
    const policy = resolved(capped)
    const samples = Array.from(
      { length: 201 },
      (_, i) => afterPolicy(policy, 0, (i + 0.5) / 201).availableAt - now
    )
    expect(samples).toEqual(Array.from({ length: 201 }, (_, i) => 800 + i))
    expect(samples.filter((n) => n === 1000)).toHaveLength(1)
    const minute = Retry.fixed(Duration.minutes(1)).pipe(
      Retry.capped(Duration.minutes(1)),
      Retry.jittered()
    )
    expect(
      [0, 0.5, 1 - Number.EPSILON].map((u) => after(minute, 0, u).availableAt - now)
    ).toEqual([48000, 54000, 60000])
    const nearCap = Retry.fixed(Duration.seconds(55)).pipe(
      Retry.capped(Duration.minutes(1)),
      Retry.jittered()
    )
    expect(
      [0, 1 - Number.EPSILON].map((u) => after(nearCap, 0, u).availableAt - now)
    ).toEqual([44000, 60000])
  })

  it("uses exact integer bounds, including tiny and maximum supported durations", () => {
    for (const n of [1, 2, 3, 4, 5, Policy.maximumMillis - 1, Policy.maximumMillis]) {
      const policy = resolved(
        Retry.fixed(Duration.millis(n)).pipe(
          Retry.capped(Duration.millis(n)),
          Retry.jittered()
        )
      )
      expect(Delay.delay(policy.retrySchedule, 1, 0)).toBe(
        Number((BigInt(n) * 4n + 4n) / 5n)
      )
      expect(
        Delay.delay(policy.retrySchedule, 1, 1 - Number.EPSILON)
      ).toBeLessThanOrEqual(n)
      expect(Delay.delay(policy.retrySchedule, 1, 0)).toBeGreaterThanOrEqual(1)
    }
  })

  it("retains stored Full jitter, including zero, instead of reinterpreting it as proportional", () => {
    const policy = Schema.decodeUnknownSync(Policy.PersistedJobPolicy)({
      ...Policy.defaultPolicy,
      retrySchedule: {
        _tag: "BackoffV1",
        delayMillis: 10,
        factor: 2,
        maxDelayMillis: 60,
        jitter: "Full"
      }
    })
    expect(afterPolicy(policy, 0, 0).availableAt).toBe(now)
    expect(afterPolicy(policy, 0, 0.5).availableAt).toBe(now + 5)
    expect(afterPolicy(policy, 0, 1 - Number.EPSILON).availableAt).toBe(now + 10)
    expect(
      afterPolicy(
        resolved(Retry.fixed(Duration.millis(10)).pipe(Retry.jittered())),
        0,
        0.5
      ).availableAt
    ).toBe(now + 10)
  })

  it("supports fractional factors, caps below the base and saturates huge factors", () => {
    const retry = Retry.exponential(Duration.millis(3), { factor: 1.5 }).pipe(
      Retry.maxAttempts(10)
    )
    expect([0, 1, 2].map((n) => after(retry, n).availableAt - now)).toEqual([3, 4, 6])
    expect(after(retry.pipe(Retry.capped(Duration.millis(1)))).availableAt).toBe(now + 1)
    const huge = Retry.exponential(Duration.millis(1), { factor: Number.MAX_VALUE }).pipe(
      Retry.capped(Duration.millis(100)),
      Retry.maxAttempts(100)
    )
    expect(after(huge, 98).availableAt).toBe(now + 100)
  })

  it("does not compute an unused overflowing delay or need entropy after exhaustion", () => {
    const row = after(
      Retry.exponential(Duration.millis(Policy.maximumMillis)).pipe(
        Retry.jittered(),
        Retry.maxAttempts(1)
      )
    )
    expect(row.state).toBe("Dead")
    expect(row.availableAt).toBe(now)
    expect(row.attemptsMade).toBe(1)
  })

  it.each([1, 2, 5, 100])(
    "bounds finalized attempts at %i, including the first",
    (count) => {
      const retry = Retry.exponential(Duration.millis(1)).pipe(
        Retry.capped(Duration.millis(10)),
        Retry.maxAttempts(count)
      )
      let row = pending({ policy: resolved(retry) })
      for (let n = 1; n <= count; n++) {
        row = value(Lifecycle.claim(row, token, row.availableAt, 1))
        row = value(
          Lifecycle.finalize(
            row,
            ownership(row),
            Lifecycle.JobFinalizations.Retry({ code }),
            row.updatedAt
          )
        )
        expect(row.attemptsMade).toBe(n)
        expect(row.state).toBe(n === count ? "Dead" : "RetryScheduled")
      }
      expect(Result.isFailure(Lifecycle.claim(row, token, row.availableAt, 1))).toBe(true)
    }
  )

  it.each([-1, 0, 1])("compares notAfter to the sampled time, offset %i", (offset) => {
    const row = active({
      policy: resolved(Retry.exponential(Duration.millis(10)).pipe(Retry.jittered()))
    })
    const next = value(
      Lifecycle.finalize(
        row,
        ownership(row),
        Lifecycle.JobFinalizations.Retry({
          code,
          jitterSample: 0.5,
          notAfter: now + 10 + offset
        }),
        now
      )
    )
    expect(next.availableAt).toBe(now + 10)
    expect(next.state).toBe(offset > 0 ? "RetryScheduled" : "Dead")
  })

  it("reconciles the identical sampled command after restart/response loss and preserves recovery counters", () => {
    const before = active({
      policy: resolved(Retry.exponential(Duration.millis(10)).pipe(Retry.jittered()))
    })
    const request = {
      before,
      ownership: ownership(before),
      finalization: Lifecycle.JobFinalizations.Retry({ code, jitterSample: 0.5 })
    }
    const stored = value(
      Lifecycle.finalize(before, request.ownership, request.finalization, now)
    )
    const reloaded = JSON.parse(JSON.stringify(stored))
    expect(
      value(Reconciliation.inspectFinalization(request, reloaded, now + 1))._tag
    ).toBe("Applied")
    expect(value(Reconciliation.inspectFinalization(request, before, now + 1))._tag).toBe(
      "StillOwned"
    )
    const different = {
      ...request,
      finalization: Lifecycle.JobFinalizations.Retry({ code, jitterSample: 0 })
    }
    expect(
      value(Reconciliation.inspectFinalization(different, reloaded, now + 1))._tag
    ).toBe("OwnershipLost")
    const recovered = value(Lifecycle.recoverExpired(before, before.leaseExpiresAt!))
    expect(recovered.attemptsMade).toBe(0)
    expect(recovered.stalledCount).toBe(1)
  })

  it.each([undefined, -1, 1, Infinity, NaN])(
    "rejects missing or invalid entropy %s",
    (jitterSample) => {
      const row = active({
        policy: resolved(Retry.fixed(Duration.millis(5)).pipe(Retry.jittered()))
      })
      expect(
        Result.isFailure(
          Lifecycle.finalize(
            row,
            ownership(row),
            Lifecycle.JobFinalizations.Retry({
              code,
              ...(jitterSample === undefined ? {} : { jitterSample })
            }),
            now
          )
        )
      ).toBe(true)
    }
  )

  it.each([0, -1, 0.5, Infinity, NaN, Policy.maximumMillis + 1])(
    "defers invalid durations %s to typed assembly",
    async (n) => {
      for (const build of [Retry.fixed, Retry.exponential]) {
        let retry!: Retry.JobRetryPolicy
        expect(() => {
          retry = build(Duration.millis(n))
        }).not.toThrow()
        expect((await configurationFailure({ retry })).field).toBe("retry.delay")
      }
      const retry = Retry.fixed(Duration.seconds(1)).pipe(
        Retry.capped(Duration.millis(n))
      )
      expect((await configurationFailure({ retry })).field).toBe("retry.maxDelay")
    }
  )

  it("checks nanosecond precision and rejects conflicting legacy/new input via Fail", async () => {
    expect(
      (await configurationFailure({ retry: Retry.fixed(Duration.nanos(1000001n)) })).field
    ).toBe("retry.delay")
    expect(
      resolved(Retry.fixed(Duration.nanos(253402300799999000000n))).retrySchedule
        .delayMillis
    ).toBe(Policy.maximumMillis)
    const retry = Retry.fixed(Duration.seconds(1))
    expect((await configurationFailure({ retry, maxAttempts: 3 })).field).toBe("retry")
    expect(
      (await configurationFailure({ retry, retryDelay: Duration.seconds(1) })).field
    ).toBe("retry")
  })

  it("keeps malformed JavaScript descriptions and durations in the typed error channel", async () => {
    for (const input of [
      null,
      {},
      { schedule: null, maxAttempts: 3 },
      Policy.defaultPolicy
    ]) {
      expect(
        (await configurationFailure({ retry: input as unknown as Retry.JobRetryPolicy }))
          .field
      ).toBe("retry")
    }
    const retry = Retry.fixed(5000 as unknown as Duration.Duration)
    expect((await configurationFailure({ retry })).field).toBe("retry.delay")
    expect(
      (
        await configurationFailure({
          retry: Retry.fixed(Duration.seconds(1)).pipe(
            Retry.maxAttempts(null as unknown as number)
          )
        })
      ).field
    ).toBe("retry.maxAttempts")
  })

  it.each([0, 1, -1, Infinity, NaN])(
    "defers invalid exponential factor %s to typed assembly",
    async (factor) => {
      const retry = Retry.exponential(Duration.seconds(1), { factor })
      expect((await configurationFailure({ retry })).field).toBe("retry.factor")
    }
  )
  it.each([0, -1, 1.5, 101, Infinity, NaN])(
    "defers invalid attempt limit %s to typed assembly",
    async (count) => {
      const retry = Retry.fixed(Duration.seconds(1)).pipe(Retry.maxAttempts(count))
      expect((await configurationFailure({ retry })).field).toBe("retry.maxAttempts")
    }
  )
  it("rejects incomplete/future stored formats without defaults", () => {
    const policy = resolved(Retry.exponential(Duration.seconds(1)))
    for (const schedule of [
      {
        _tag: "BackoffV2",
        delayMillis: 1000,
        factor: 2,
        maxDelayMillis: 60000,
        jitter: "ProportionalV1"
      },
      { _tag: "BackoffV1", delayMillis: 1000, factor: 2, maxDelayMillis: 60000 },
      {
        _tag: "BackoffV1",
        delayMillis: 1000,
        factor: 0,
        maxDelayMillis: 60000,
        jitter: "Full"
      },
      {
        _tag: "BackoffV1",
        delayMillis: 1000,
        factor: 2,
        maxDelayMillis: 0,
        jitter: "Full"
      },
      {
        _tag: "BackoffV1",
        delayMillis: 1000,
        factor: 2,
        maxDelayMillis: 60000,
        jitter: "Custom"
      }
    ]) {
      expect(
        Schema.is(Policy.PersistedJobPolicy)({ ...policy, retrySchedule: schedule })
      ).toBe(false)
    }
  })
})
