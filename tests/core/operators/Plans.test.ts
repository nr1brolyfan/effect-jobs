import { Duration, Result, Schema } from "effect"
import { describe, expect, test } from "vitest"
import * as Lifecycle from "../../../src/JobLifecycle.js"
import * as Policy from "../../../src/JobPolicy.js"
import { FailureCode } from "../../../src/JobFailure.js"
import { JobOperatorExpected } from "../../../src/JobOperators.js"
import { pending, active, now, ownership } from "../lifecycle/fixtures.js"

const guard = (row: Lifecycle.JobSnapshot): JobOperatorExpected => ({
  jobId: row.jobId,
  state: row.state,
  lifecycleVersion: row.lifecycleVersion
})
const failure = (result: Result.Result<unknown, Lifecycle.JobLifecycleError>) =>
  Result.isFailure(result) ? result.failure.reason : undefined
const states = [
  "Pending",
  "Active",
  "RetryScheduled",
  "Completed",
  "Dead",
  "Isolated",
  "Cancelled"
] as const
const rowFor = (state: (typeof states)[number]) =>
  state === "Active"
    ? active()
    : pending({
        state,
        availableAt: now + 1,
        completedAt: ["Completed", "Dead", "Cancelled"].includes(state) ? now - 2 : null
      })

describe("operator plans", () => {
  test.each(states)("state matrix: %s", (state) => {
    const row = rowFor(state)
    expect(Result.isSuccess(Lifecycle.retryNow(row, guard(row), now))).toBe(
      state === "RetryScheduled"
    )
    expect(Result.isSuccess(Lifecycle.cancel(row, guard(row), now))).toBe(
      state === "Pending" || state === "RetryScheduled"
    )
  })
  test.each([-1, 0, 1])("strict stored retry cutoff at %+d milliseconds", (delta) => {
    const row = pending({
      state: "RetryScheduled",
      availableAt: now + delta,
      attemptsMade: 1,
      stalledCount: 1
    })
    const result = Lifecycle.retryNow(row, guard(row), now)
    if (delta <= 0) {
      expect(failure(result)).toBe("already-due")
    } else {
      expect(Result.getOrThrow(result)).toEqual({
        ...row,
        availableAt: now,
        updatedAt: now,
        lifecycleVersion: 1
      })
    }
  })
  test("finalize cutoff equality and adjacent scheduling stay intact", () => {
    const row = active()
    for (const delta of [-1, 0, 1]) {
      const retry = Result.getOrThrow(
        Lifecycle.finalize(
          row,
          ownership(row),
          Lifecycle.JobFinalizations.Retry({
            code: Schema.decodeSync(FailureCode)("retry"),
            notAfter: now + row.policy.retrySchedule.delayMillis + delta
          }),
          now
        )
      )
      expect(retry.state).toBe(delta <= 0 ? "Dead" : "RetryScheduled")
      if (delta > 0) {
        expect(
          Result.getOrThrow(Lifecycle.retryNow(retry, guard(retry), now)).availableAt
        ).toBeLessThan(now + row.policy.retrySchedule.delayMillis + delta)
      }
    }
  })
  test.each(states)("all stale guards reject in %s", (state) => {
    const row = rowFor(state)
    for (const invalid of [
      {
        ...guard(row),
        jobId: pending({
          jobId: Schema.decodeSync(JobOperatorExpected.fields.jobId)("foreign")
        }).jobId
      },
      {
        ...guard(row),
        state: state === "Dead" ? ("Pending" as const) : ("Dead" as const)
      },
      { ...guard(row), lifecycleVersion: row.lifecycleVersion + 1 }
    ]) {
      expect(failure(Lifecycle.cancel(row, invalid, now))).toBe("state-version-conflict")
      expect(failure(Lifecycle.retryNow(row, invalid, now))).toBe(
        "state-version-conflict"
      )
    }
  })
  test("Cancelled has a terminal timestamp, unchanged history and Forever cleanup", () => {
    const row = pending({
      state: "RetryScheduled",
      attemptsMade: 1,
      stalledCount: 1,
      policy: Policy.make({
        deadRetention: Duration.millis(1),
        completedRetention: Duration.millis(1)
      })
    })
    const cancelled = Result.getOrThrow(Lifecycle.cancel(row, guard(row), now))
    expect(cancelled).toEqual({
      ...row,
      state: "Cancelled",
      completedAt: now,
      updatedAt: now,
      lifecycleVersion: 1
    })
    expect(Schema.is(Lifecycle.JobSnapshot)(cancelled)).toBe(true)
    expect(Schema.is(Lifecycle.JobSnapshot)({ ...cancelled, completedAt: null })).toBe(
      false
    )
    expect(Result.getOrThrow(Lifecycle.cleanupEligible(cancelled, now + 10000))).toBe(
      false
    )
    expect(failure(Lifecycle.claim(cancelled, "abcd", now, 1))).toBe("not-eligible")
    expect(failure(Lifecycle.recoverExpired(cancelled, now))).toBe("not-eligible")
    expect(
      failure(
        Lifecycle.finalize(
          cancelled,
          ownership(),
          Lifecycle.JobFinalizations.Complete(),
          now
        )
      )
    ).toBe("ownership-lost")
  })
  test.each(["retryNow", "cancel"] as const)(
    "%s rejects overflow, bad time, counters and leases",
    (action) => {
      const row = pending({
        state: "RetryScheduled",
        availableAt: now + 10,
        lifecycleVersion: Number.MAX_SAFE_INTEGER
      })
      expect(failure(Lifecycle[action](row, guard(row), now))).toBe("arithmetic-bound")
      expect(failure(Lifecycle[action](row, guard(row), 0))).toBe("invalid-command")
      for (const invalid of [
        { ...row, attemptsMade: row.policy.maxAttempts },
        { ...row, stalledCount: row.policy.maxStalledCount + 1 },
        { ...row, leaseToken: "abcd" },
        { ...row, attemptsMade: -1 },
        {
          ...row,
          policy: { ...row.policy, attemptTimeoutMillis: row.policy.leaseDurationMillis }
        }
      ]) {
        expect(failure(Lifecycle[action](invalid, guard(row), now))).toBe(
          "invalid-snapshot"
        )
      }
    }
  )
})
