import { Result, Schema } from "effect"
import { expect, test } from "vitest"
import * as L from "../../../src/JobLifecycle.js"
import { define } from "../../../src/FailureCode.js"
import { pending, now, token } from "./fixtures.js"

const codes = define({
  retry: "fixture_retry",
  dead: "fixture_dead",
  isolate: "fixture_isolate"
})

test.each([null, now - 100])(
  "all lifecycle plans preserve creation time %s",
  (createdAt) => {
    const initial = pending({ createdAt })
    const claimed = Result.getOrThrow(L.claim(initial, token, now, 10))
    const ownership = Result.getOrThrow(L.ownershipOf(claimed))
    const released = Result.getOrThrow(
      L.release(claimed, ownership, now + 1, "BeforeExecution")
    )
    const recovered = Result.getOrThrow(
      L.recoverExpired(claimed, claimed.leaseExpiresAt!)
    )
    for (const command of [
      L.JobFinalizations.Complete(),
      L.JobFinalizations.Retry({ code: codes.retry }),
      L.JobFinalizations.Dead({ code: codes.dead }),
      L.JobFinalizations.Isolate({ code: codes.isolate })
    ]) {
      const after = Result.getOrThrow(L.finalize(claimed, ownership, command, now + 1))
      expect(after.createdAt).toBe(createdAt)
    }
    const future = pending({ createdAt, state: "RetryScheduled", availableAt: now + 100 })
    const guard = {
      jobId: future.jobId,
      state: future.state,
      lifecycleVersion: future.lifecycleVersion
    }
    const retryNow = Result.getOrThrow(L.retryNow(future, guard, now))
    const cancelled = Result.getOrThrow(L.cancel(future, guard, now))
    for (const after of [claimed, released, recovered, retryNow, cancelled]) {
      expect(after.createdAt).toBe(createdAt)
    }
    // Cleanup eligibility inspects terminal time; it never rewrites creation metadata.
    const complete = Result.getOrThrow(
      L.finalize(claimed, ownership, L.JobFinalizations.Complete(), now + 1)
    )
    L.cleanupEligible(complete, now + 100)
    expect(complete.createdAt).toBe(createdAt)
  }
)

test("creation metadata is bounded and additive for older custom snapshot producers", () => {
  expect(Schema.is(L.JobSnapshot)(pending())).toBe(true)
  for (const createdAt of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER, "123"]) {
    expect(Schema.is(L.JobSnapshot)({ ...pending(), createdAt })).toBe(false)
  }
})
