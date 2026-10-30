import { Duration, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Retry from "../../src/JobRetryPolicy.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Lifecycle from "../../src/JobLifecycle.js"
import * as Codes from "../../src/FailureCode.js"
import * as Reconciliation from "../../src/internal/lifecycle/Reconciliation.js"
import { active, now, ownership, pending, token } from "./lifecycle/fixtures.js"

const code = Codes.define({ temporary: "temporary" }).temporary
const value = Result.getOrThrow
const after = (retry: Retry.JobRetryPolicy, attemptsMade = 0, sample?: number) => {
  const row = active({ policy: Policy.make({ retry }), attemptsMade })
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

describe("composable durable retries", () => {
  it("rejects incomplete or future persisted schedules without applying defaults", () => {
    const base = Policy.make({ retry: Retry.exponential(Duration.seconds(1)) })
    for (const schedule of [
      {
        _tag: "BackoffV2",
        delayMillis: 1000,
        factor: 2,
        maxDelayMillis: 60000,
        jitter: "Full"
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
        Schema.is(Policy.PersistedJobPolicy)({ ...base, retrySchedule: schedule })
      ).toBe(false)
    }
  })
  it("resolves immutable builders, with unchanged defaults and V1 fixed policy", () => {
    const fixed = Retry.fixed(Duration.seconds(5))
    expect(Policy.make({ retry: fixed })).toEqual(Policy.make())
    const retry = Retry.exponential(Duration.seconds(1)).pipe(
      Retry.capped(Duration.minutes(1)),
      Retry.jittered(),
      Retry.maxAttempts(5)
    )
    const policy = Policy.make({ retry })
    expect(policy.maxAttempts).toBe(5)
    expect(policy.retrySchedule).toEqual({
      _tag: "BackoffV1",
      delayMillis: 1000,
      factor: 2,
      maxDelayMillis: 60000,
      jitter: "Full"
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
    expect(Retry.maxAttempts(10)(retry).maxAttempts).toBe(10)
    expect(retry.maxAttempts).toBe(5)
    expect(
      Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(
        JSON.parse(JSON.stringify(policy))
      )
    ).toEqual(policy)
  })

  it("progresses from the first retry, caps before jitter and survives serialization", () => {
    const retry = Retry.exponential(Duration.millis(3)).pipe(
      Retry.capped(Duration.millis(10)),
      Retry.maxAttempts(10)
    )
    expect([0, 1, 2, 3, 4].map((n) => after(retry, n).availableAt - now)).toEqual([
      3, 6, 10, 10, 10
    ])
    const left = retry.pipe(Retry.jittered(), Retry.capped(Duration.millis(5)))
    const right = retry.pipe(Retry.capped(Duration.millis(5)), Retry.jittered())
    expect(Policy.make({ retry: left })).toEqual(Policy.make({ retry: right }))
    expect(after(left, 3, 0).availableAt).toBe(now)
    expect(after(left, 3, 0.5).availableAt).toBe(now + 3)
    expect(after(left, 3, 1 - Number.EPSILON).availableAt).toBe(now + 5)
    expect(
      after(
        Retry.fixed(Duration.millis(100)).pipe(
          Retry.capped(Duration.millis(3)),
          Retry.jittered()
        ),
        0,
        0.5
      ).availableAt
    ).toBe(now + 2)
    const policy = Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(
      JSON.parse(JSON.stringify(Policy.make({ retry: left })))
    )
    const row = active({ policy, attemptsMade: 1 })
    expect(
      value(
        Lifecycle.finalize(
          row,
          ownership(row),
          Lifecycle.JobFinalizations.Retry({ code, jitterSample: 0.5 }),
          now
        )
      ).availableAt
    ).toBe(now + 3)
  })

  it("supports custom factors, caps below the base and saturates huge factors", () => {
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

  it("does not compute an unused overflowing delay or require jitter after exhaustion", () => {
    const retry = Retry.exponential(Duration.millis(Policy.maximumMillis)).pipe(
      Retry.jittered(),
      Retry.maxAttempts(1)
    )
    const row = after(retry)
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
      let row = pending({ policy: Policy.make({ retry }) })
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

  it.each([-1, 0, 1])(
    "applies notAfter to the actual jittered time, offset %i",
    (offset) => {
      const policy = Policy.make({
        retry: Retry.exponential(Duration.millis(10)).pipe(Retry.jittered())
      })
      const row = active({ policy })
      const next = value(
        Lifecycle.finalize(
          row,
          ownership(row),
          Lifecycle.JobFinalizations.Retry({
            code,
            jitterSample: 0.5,
            notAfter: now + 5 + offset
          }),
          now
        )
      )
      expect(next.availableAt).toBe(now + 5)
      expect(next.state).toBe(offset > 0 ? "RetryScheduled" : "Dead")
    }
  )

  it("reconciles the same sampled command after response loss, without rerandomization", () => {
    const policy = Policy.make({
      retry: Retry.exponential(Duration.millis(10)).pipe(Retry.jittered())
    })
    const before = active({ policy })
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
    "rejects missing/invalid jitter entropy %s",
    (jitterSample) => {
      const row = active({
        policy: Policy.make({
          retry: Retry.fixed(Duration.millis(5)).pipe(Retry.jittered())
        })
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
    "rejects invalid duration %s",
    (n) => {
      for (const build of [Retry.fixed, Retry.exponential, Retry.capped]) {
        expect(() => build(Duration.millis(n))).toThrow(
          Retry.JobRetryPolicyConfigurationError
        )
      }
    }
  )

  it("checks exact nanoseconds and rejects competing policy inputs", () => {
    expect(() => Retry.fixed(Duration.nanos(1000001n))).toThrow(
      Retry.JobRetryPolicyConfigurationError
    )
    expect(Retry.fixed(Duration.nanos(253402300799999000000n)).schedule.delayMillis).toBe(
      Policy.maximumMillis
    )
    const retry = Retry.fixed(Duration.seconds(1))
    expect(() => Policy.make({ retry, maxAttempts: 3 })).toThrow(
      Policy.JobPolicyConfigurationError
    )
    expect(() => Policy.make({ retry, retryDelay: Duration.seconds(1) })).toThrow(
      Policy.JobPolicyConfigurationError
    )
  })

  it.each([0, 1, -1, Infinity, NaN])(
    "rejects invalid exponential factor %s",
    (factor) => {
      expect(() => Retry.exponential(Duration.seconds(1), { factor })).toThrow(
        Retry.JobRetryPolicyConfigurationError
      )
    }
  )

  it.each([0, -1, 1.5, 101, Infinity, NaN])(
    "rejects invalid attempt limit %s",
    (count) => {
      expect(() => Retry.maxAttempts(count)).toThrow(
        Retry.JobRetryPolicyConfigurationError
      )
    }
  )
})
