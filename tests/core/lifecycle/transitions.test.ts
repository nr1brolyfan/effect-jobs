import * as FailureCodes from "../../../src/FailureCode.js"
import { Cause, Duration, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as L from "../../../src/JobLifecycle.js"
import * as Policy from "../../../src/JobPolicy.js"
import { JobId } from "../../../src/JobId.js"
import { active, now, ownership, pending, policy, token } from "./fixtures.js"

const value = Result.getOrThrow
const reason = <A>(result: Result.Result<A, L.JobLifecycleError>) => {
  expect(Result.isFailure(result)).toBe(true)
  return Result.isFailure(result) ? result.failure.reason : undefined
}
const commands = [
  L.JobFinalizations.Complete(),
  L.JobFinalizations.Retry({ code: FailureCodes.define({ value: "temporary" }).value }),
  L.JobFinalizations.Dead({ code: FailureCodes.define({ value: "rejected" }).value }),
  L.JobFinalizations.Isolate({ code: FailureCodes.define({ value: "malformed" }).value })
]

describe("portable lifecycle (not database qualification)", () => {
  it.each([
    [L.JobFinalizations.Complete(), "Completed", null],
    [
      L.JobFinalizations.Retry({
        code: FailureCodes.define({ value: "temporary" }).value
      }),
      "RetryScheduled",
      "temporary"
    ],
    [
      L.JobFinalizations.Dead({ code: FailureCodes.define({ value: "rejected" }).value }),
      "Dead",
      "rejected"
    ],
    [
      L.JobFinalizations.Isolate({
        code: FailureCodes.define({ value: "malformed" }).value
      }),
      "Isolated",
      "malformed"
    ]
  ] as const)("known $0._tag transition", (command, state, code) => {
    const before = active({ attemptsMade: 1, stalledCount: 1 })
    const after = value(L.finalize(before, ownership(before), command, now + 1))
    expect(after).toMatchObject({
      state,
      lastFailureCode: code,
      attemptsMade: 2,
      stalledCount: 1,
      lifecycleVersion: 2,
      updatedAt: now + 1,
      leaseToken: null,
      leaseExpiresAt: null
    })
    expect(after.completedAt).toBe(
      state === "Completed" || state === "Dead" ? now + 1 : null
    )
    expect(before.attemptsMade).toBe(1)
  })
  it.each(["Pending", "RetryScheduled", "Completed", "Dead", "Isolated"] as const)(
    "recovery rejects %s",
    (state) => {
      const row = pending({
        state,
        completedAt: state === "Completed" || state === "Dead" ? now : null
      })
      expect(reason(L.recoverExpired(row, now + 100))).toBe("not-eligible")
    }
  )
  it.each([-1, 0, 1])("due availability offset %i", (offset) => {
    const row = pending({ availableAt: now + offset })
    const result = L.claim(row, token, now, 10)
    expect(Result.isSuccess(result)).toBe(offset <= 0)
    expect(row.state).toBe("Pending")
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        state: "Active",
        attemptsMade: 0,
        stalledCount: 0,
        lifecycleVersion: 1,
        updatedAt: now,
        leaseExpiresAt: now + 100
      })
      expect(result.success.policy).toEqual(policy)
      expect(L.attemptNumber(result.success)).toBe(1)
      expect(Schema.is(L.JobSnapshot)(result.success)).toBe(true)
    }
  })
  it.each([
    "Pending",
    "RetryScheduled",
    "Active",
    "Completed",
    "Dead",
    "Isolated"
  ] as const)("claim from %s", (state) => {
    const row =
      state === "Active"
        ? active()
        : pending({
            state,
            completedAt: state === "Completed" || state === "Dead" ? now : null
          })
    expect(Result.isSuccess(L.claim(row, token, now, 10))).toBe(
      state === "Pending" || state === "RetryScheduled"
    )
  })
  it.each([69, 70, 71])("claim response budget %i", (budget) => {
    expect(Result.isSuccess(L.claim(pending(), token, now, budget))).toBe(budget <= 70)
    expect(L.usableLease(active(), now, budget)).toBe(budget <= 70)
  })
  it.each([-1, 0, 1])("remaining lease at equality + %i", (offset) => {
    expect(L.usableLease(active(), now + 60 + offset, 10)).toBe(offset <= 0)
  })
  for (const command of commands) {
    it.each([-1, 0, 1])(`${command._tag} at expiry + %i`, (offset) => {
      const result = L.finalize(active(), ownership(), command, now + 100 + offset)
      expect(Result.isSuccess(result)).toBe(offset < 0)
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("ownership-lost")
      } else {
        expect(result.success.attemptsMade).toBe(1)
        expect(result.success.lifecycleVersion).toBe(2)
        expect(result.success.leaseToken).toBeNull()
        expect(result.success.leaseExpiresAt).toBeNull()
        expect(Schema.is(L.JobSnapshot)(result.success)).toBe(true)
        expect(reason(L.finalize(result.success, ownership(), command, now + 99))).toBe(
          "ownership-lost"
        )
      }
    })
    it.each(["jobId", "leaseToken", "lifecycleVersion", "leaseExpiresAt"] as const)(
      `${command._tag} fences stale %s`,
      (field) => {
        const stale = {
          ...ownership(),
          [field]:
            field === "jobId"
              ? Schema.decodeSync(JobId)("other")
              : field === "leaseToken"
                ? "ffff"
                : (ownership()[field] as number) + 1
        }
        expect(reason(L.finalize(active(), stale, command, now + 1))).toBe(
          "ownership-lost"
        )
        expect(reason(L.release(active(), stale, now + 1, "BeforeExecution"))).toBe(
          "ownership-lost"
        )
      }
    )
    it.each(["Pending", "RetryScheduled", "Completed", "Dead", "Isolated"] as const)(
      `${command._tag} rejects nonowned %s`,
      (state) => {
        const row = pending({
          state,
          completedAt: state === "Completed" || state === "Dead" ? now : null
        })
        expect(reason(L.finalize(row, ownership(), command, now))).toBe("ownership-lost")
        expect(reason(L.release(row, ownership(), now, "BeforeExecution"))).toBe(
          "ownership-lost"
        )
      }
    )
  }
  it.each([-1, 0, 1])("release at expiry + %i", (offset) => {
    const result = L.release(active(), ownership(), now + 100 + offset, "BeforeExecution")
    expect(Result.isSuccess(result)).toBe(offset < 0)
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        state: "Pending",
        attemptsMade: 0,
        stalledCount: 0,
        lifecycleVersion: 2,
        availableAt: now + 99,
        updatedAt: now + 99
      })
    }
  })
  it("never releases after execution starts", () => {
    expect(reason(L.release(active(), ownership(), now, "Executing"))).toBe(
      "execution-started"
    )
  })
  it.each([-1, 0, 1])("retry cutoff at next availability + %i", (offset) => {
    const row = value(
      L.finalize(
        active(),
        ownership(),
        L.JobFinalizations.Retry({
          code: FailureCodes.define({ value: "temporary" }).value,
          notAfter: now + 6 + offset
        }),
        now + 1
      )
    )
    expect(row.state).toBe(offset <= 0 ? "Dead" : "RetryScheduled")
    expect(row.availableAt).toBe(now + 6)
    expect(row.completedAt).toBe(offset <= 0 ? now + 1 : null)
  })
  it.each([1, 3, 100])("maxAttempts %i includes first finalization", (maxAttempts) => {
    let row = pending({ policy: Policy.make({ maxAttempts }) })
    for (let n = 1; n <= maxAttempts; n++) {
      row = value(L.claim(row, token, row.availableAt, 1))
      expect(L.attemptNumber(row)).toBe(n)
      const next = value(
        L.finalize(
          row,
          ownership(row),
          L.JobFinalizations.Retry({
            code: FailureCodes.define({ value: "temporary" }).value
          }),
          row.updatedAt + 1
        )
      )
      expect(next.attemptsMade).toBe(n)
      expect(next.state).toBe(n === maxAttempts ? "Dead" : "RetryScheduled")
      row = next
    }
    expect(reason(L.claim(row, token, row.availableAt, 1))).toBe("not-eligible")
  })
  it.each([-1, 0, 1])("recovery at expiry + %i", (offset) => {
    const result = L.recoverExpired(active(), now + 100 + offset)
    expect(Result.isSuccess(result)).toBe(offset >= 0)
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        state: "Pending",
        attemptsMade: 0,
        stalledCount: 1,
        lifecycleVersion: 2,
        leaseToken: null,
        leaseExpiresAt: null
      })
    }
  })
  it.each([0, 1, 100])(
    "stall budget %i, unknown leaves attempts unchanged",
    (maxStalledCount) => {
      let row = pending({ policy: Policy.make({ maxStalledCount }) })
      for (let n = 1; n <= maxStalledCount + 1; n++) {
        row = value(L.claim(row, token, Math.max(now, row.updatedAt), 1))
        expect(L.attemptNumber(row)).toBe(1)
        const expiry = row.leaseExpiresAt!
        row = value(L.recoverExpired(row, expiry))
        expect(row.state).toBe(n > maxStalledCount ? "Dead" : "Pending")
        expect(row.stalledCount).toBe(n)
        expect(row.attemptsMade).toBe(0)
        expect(Schema.is(L.JobSnapshot)(row)).toBe(true)
      }
      expect(row.lastFailureCode).toBe("stall_limit_exceeded")
    }
  )
  it("only bounded explicit failure values produce finalizations", () => {
    for (const command of commands.filter((c) => c._tag !== "Complete")) {
      expect(value(L.finalizationFromFailure(command))).toEqual(command)
    }
    expect(
      value(L.finalizationFromFailure({ _tag: "OutcomeUnknown", code: "lost_response" }))
    ).toBeNull()
    for (const input of [
      Cause.fail({ _tag: "Retry", code: "x" }),
      Cause.die("private"),
      new Error("private"),
      { _tag: "Timeout" },
      { _tag: "Complete" },
      { _tag: "Retry", code: "x", message: "private" },
      { _tag: "Retry", code: "x".repeat(129) }
    ]) {
      expect(reason(L.finalizationFromFailure(input))).toBe("invalid-command")
    }
  })
  it.each([-1, 0, 1])("retention at expiry + %i", (offset) => {
    const completed = value(L.finalize(active(), ownership(), commands[0]!, now + 1))
    expect(value(L.cleanupEligible(completed, now + 11 + offset))).toBe(offset >= 0)
  })
  it("cleanup excludes nonterminal and infinite retention", () => {
    for (const row of [
      pending(),
      active(),
      pending({ state: "RetryScheduled" }),
      value(L.finalize(active(), ownership(), commands[3]!, now + 1)),
      value(L.finalize(active(), ownership(), commands[2]!, now + 1))
    ]) {
      expect(value(L.cleanupEligible(row, now + 1000))).toBe(false)
    }
    const row = active({
      policy: { ...policy, deadRetention: { _tag: "Duration", millis: 10 } }
    })
    expect(
      value(
        L.cleanupEligible(
          value(L.finalize(row, ownership(row), commands[2]!, now)),
          now + 10
        )
      )
    ).toBe(true)
  })
  it.each([0, -1, 1.5, NaN, Infinity, Policy.maximumMillis + 1])(
    "invalid DB time/budget %s",
    (n) => {
      expect(reason(L.claim(pending(), token, n, 1))).toBe("invalid-command")
      expect(reason(L.claim(pending(), token, now, n))).toBe("invalid-command")
      expect(reason(L.finalize(active(), ownership(), commands[0]!, n))).toBe(
        "invalid-command"
      )
      expect(reason(L.recoverExpired(active(), n))).toBe("invalid-command")
      expect(reason(L.cleanupEligible(pending(), n))).toBe("invalid-command")
      expect(L.usableLease(active(), n, 1)).toBe(false)
    }
  )
  it("timestamp arithmetic accepts equality and rejects overflow without clamping", () => {
    const max = Policy.maximumMillis
    expect(value(L.addTimestamp(max - 1, 1))).toBe(max)
    expect(reason(L.addTimestamp(max, 1))).toBe("arithmetic-bound")
    expect(Result.isSuccess(L.claim(pending(), token, max - 100, 1))).toBe(true)
    expect(reason(L.claim(pending(), token, max - 99, 1))).toBe("arithmetic-bound")
    const row = active({ leaseExpiresAt: max, updatedAt: max - 10 })
    expect(reason(L.finalize(row, ownership(row), commands[1]!, max - 1))).toBe(
      "arithmetic-bound"
    )
    const completed = pending({ state: "Completed", completedAt: max, updatedAt: max })
    expect(reason(L.cleanupEligible(completed, max))).toBe("arithmetic-bound")
  })
  it("version increments cannot overflow", () => {
    const version = Number.MAX_SAFE_INTEGER
    expect(
      value(L.claim(pending({ lifecycleVersion: version - 1 }), token, now, 1))
        .lifecycleVersion
    ).toBe(version)
    expect(reason(L.claim(pending({ lifecycleVersion: version }), token, now, 1))).toBe(
      "arithmetic-bound"
    )
    const row = active({ lifecycleVersion: version })
    expect(reason(L.release(row, ownership(row), now, "BeforeExecution"))).toBe(
      "arithmetic-bound"
    )
    expect(reason(L.finalize(row, ownership(row), commands[0]!, now))).toBe(
      "arithmetic-bound"
    )
    expect(reason(L.recoverExpired(row, now + 100))).toBe("arithmetic-bound")
  })
  it.each([
    {},
    { state: "OutcomeUnknown" },
    { attemptsMade: -1 },
    { attemptsMade: 0.5 },
    { attemptsMade: 4 },
    { stalledCount: 3 },
    { lifecycleVersion: Number.MAX_SAFE_INTEGER + 1 },
    { leaseToken: token },
    { completedAt: now },
    { lastFailureCode: "private message" },
    { policy: {} },
    { policy: { ...policy, attemptTimeoutMillis: 100 } },
    { state: "Active" },
    { state: "Dead" },
    { payload: "private" }
  ])("rejects malformed storage %j", (change) => {
    const row = Object.keys(change).length === 0 ? {} : { ...pending(), ...change }
    expect(reason(L.validateSnapshot(row))).toBe("invalid-snapshot")
  })
  it.each([1, 500, 0, 501, 1.5, NaN])("batch bound %s", (n) =>
    expect(Schema.is(L.BatchLimit)(n)).toBe(n === 1 || n === 500)
  )
  it.each(["a", "F-0", "a".repeat(128), "", "a".repeat(129), "g", "a\n"])(
    "token grammar %j",
    (t) => {
      expect(Result.isSuccess(L.claim(pending(), t, now, 1))).toBe(
        t === "a" || t === "F-0" || t.length === 128
      )
    }
  )
  it("policy remains immutable and strict timeout preserved", () => {
    expect(Object.isFrozen(policy)).toBe(true)
    expect(() =>
      Policy.make({
        leaseDuration: Duration.millis(30),
        attemptTimeout: Duration.millis(30)
      })
    ).toThrow()
    expect(value(L.finalize(active(), ownership(), commands[1]!, now)).policy).toEqual(
      policy
    )
  })
})
