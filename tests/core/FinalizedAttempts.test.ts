import { Duration, Effect, Result, Schema } from "effect"
import { expect, it } from "vitest"
import * as Policy from "../../src/JobPolicy.js"
import * as Retry from "../../src/JobRetryPolicy.js"
import * as Lifecycle from "../../src/JobLifecycle.js"
import { snapshot, claimArtifact } from "../../src/postgresql/internal/Rows.js"
import { active, now, ownership, pending } from "./lifecycle/fixtures.js"
import { define } from "../../src/FailureCode.js"

const strict = { onExcessProperty: "error" } as const
const code = define({ temporary: "temporary" }).temporary

it.each([
  { _tag: "FixedDelayV1", delayMillis: 5000 },
  {
    _tag: "BackoffV1",
    delayMillis: 1000,
    factor: 2,
    maxDelayMillis: 60000,
    jitter: "Full"
  },
  {
    _tag: "BackoffV1",
    delayMillis: 1000,
    factor: 2,
    maxDelayMillis: 60000,
    jitter: "ProportionalV1"
  }
])(
  "round-trips retained policy without renaming storage fields or applying defaults: $jitter",
  (retrySchedule) => {
    // Literal retained shape is independent of the new public schema and defaults.
    const retained = {
      leaseDurationMillis: 80000,
      attemptTimeoutMillis: 20000,
      maxAttempts: 7,
      maxStalledCount: 2,
      retrySchedule,
      completedRetention: { _tag: "Duration", millis: 12345 },
      deadRetention: { _tag: "Forever" }
    }
    const decoded = Schema.decodeUnknownSync(Policy.PersistedJobPolicy, strict)(retained)
    expect(decoded.maxFinalizedAttempts).toBe(7)
    expect(decoded).not.toHaveProperty("maxAttempts")
    expect(Schema.encodeSync(Policy.PersistedJobPolicy, strict)(decoded)).toEqual(
      retained
    )
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Policy.JobPolicy, strict)(retained))
    ).toBe(true)
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Policy.PersistedJobPolicy, strict)(decoded)
      )
    ).toBe(true)
    const { deadRetention: _retention, ...incomplete } = retained
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Policy.PersistedJobPolicy)(incomplete))
    ).toBe(true)
  }
)

it("maps physical counters and retained policy once for snapshots and claimed metadata", () => {
  const policy = Effect.runSync(
    Policy.make({
      retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxFinalizedAttempts(7))
    })
  )
  const row = {
    id: pending().jobId,
    policy: Schema.encodeSync(Policy.PersistedJobPolicy)(policy),
    state: "Active",
    available_at: String(now),
    updated_at: String(now),
    created_at: null,
    attempts_made: "2",
    stalled_count: "1",
    lifecycle_version: "3",
    lease_token: ownership().leaseToken,
    lease_expires_at: String(now + 80000),
    completed_at: null,
    last_failure_code: null,
    queue: "billing",
    name: "invoice",
    version: 1,
    operation: "billing.issue",
    operation_id: "one",
    slot: "invoice",
    initial_available_at: null,
    format_version: 1,
    payload: new Uint8Array([1]),
    projection: new Uint8Array([1])
  }
  const stored = Result.getOrThrow(snapshot(row))
  expect(stored.finalizedAttempts).toBe(2)
  expect(stored).not.toHaveProperty("attemptsMade")
  expect(Lifecycle.nextFinalizationNumber(stored)).toBe(3)
  expect(Result.getOrThrow(claimArtifact(row, stored)).prepared).toMatchObject({ policy })
  expect(row.policy).toHaveProperty("maxAttempts", 7)
  expect(row.attempts_made).toBe("2")
})

it("does not consume a finalization on claim or expired-lease recovery", () => {
  const claimed = Result.getOrThrow(
    Lifecycle.claim(pending(), ownership().leaseToken, now, 1)
  )
  const recovered = Result.getOrThrow(
    Lifecycle.recoverExpired(claimed, claimed.leaseExpiresAt!)
  )
  expect(recovered.finalizedAttempts).toBe(0)
  expect(recovered.stalledCount).toBe(1)
  expect(Lifecycle.nextFinalizationNumber(recovered)).toBe(1)
  const finalized = Result.getOrThrow(
    Lifecycle.finalize(
      active(),
      ownership(),
      Lifecycle.JobFinalizations.Retry({ code }),
      now + 1
    )
  )
  expect(finalized.finalizedAttempts).toBe(1)
  expect(Lifecycle.nextFinalizationNumber(finalized)).toBe(2)
})
