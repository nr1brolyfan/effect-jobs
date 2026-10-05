import { Result } from "effect"
import { expect, it } from "vitest"
import { validateClaimArtifact } from "../../../src/internal/lifecycle/Artifacts.js"
import { claimed, ownership, prepared, policy } from "./fixtures.js"

it("validates claimed metadata and copies retained byte arrays", () => {
  const artifact = prepared()
  const claim = { ...claimed(), prepared: artifact }
  const decoded = Result.getOrThrow(validateClaimArtifact(claim))
  expect(decoded).toEqual(artifact)
  for (const part of [
    decoded,
    decoded.catalog,
    decoded.producer,
    decoded.policy,
    decoded.policy.retrySchedule,
    decoded.policy.completedRetention,
    decoded.policy.deadRetention,
    decoded.encoded
  ]) {
    expect(Object.isFrozen(part)).toBe(true)
  }
  expect(decoded.encoded.payloadBytes).not.toBe(artifact.encoded.payloadBytes)
  expect(decoded.encoded.semanticProjectionBytes).not.toBe(
    artifact.encoded.semanticProjectionBytes
  )
  artifact.encoded.payloadBytes.fill(0)
  artifact.encoded.semanticProjectionBytes.fill(0)
  expect([...decoded.encoded.payloadBytes]).toEqual([123, 125])
  expect([...decoded.encoded.semanticProjectionBytes]).toEqual([123, 125])
})
it.each([
  null,
  {},
  { ...prepared(), policy: {} },
  { ...prepared(), policy: { ...policy, maxAttempts: 4 } },
  { ...prepared(), catalog: { queue: "invalid queue", kind: "invoice", version: 1 } },
  {
    ...prepared(),
    producer: { operation: "billing.issue", operationId: "", slot: "pdf" }
  },
  { ...prepared(), availableAt: 0 },
  { ...prepared(), rawMessage: "private" },
  ...[0, 65537].map((n) => ({
    ...prepared(),
    encoded: { ...prepared().encoded, payloadBytes: new Uint8Array(n) }
  })),
  ...[0, 65537].map((n) => ({
    ...prepared(),
    encoded: { ...prepared().encoded, semanticProjectionBytes: new Uint8Array(n) }
  })),
  { ...prepared(), encoded: { ...prepared().encoded, formatVersion: 2 } },
  { ...prepared(), encoded: { ...prepared().encoded, payloadBytes: "{}" } }
])("rejects malformed persisted artifacts without raw diagnostics %j", (artifact) => {
  const result = validateClaimArtifact({ ...claimed(), prepared: artifact })
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure.reason).toBe("invalid-artifact")
    expect(JSON.stringify(result.failure)).not.toContain("private")
  }
})
it("rejects stale ownership and invalid snapshot, with no partial fallback", () => {
  const claim = claimed()
  expect(
    Result.isFailure(
      validateClaimArtifact({
        ...claim,
        ownership: { ...ownership(), leaseToken: "ffff" }
      })
    )
  ).toBe(true)
  expect(
    Result.isFailure(
      validateClaimArtifact({
        ...claim,
        snapshot: { ...claim.snapshot, attemptsMade: -1 }
      })
    )
  ).toBe(true)
})
it("structural validation does not claim codec schema/projection correctness", () => {
  const artifact = prepared()
  artifact.encoded.payloadBytes = new TextEncoder().encode("not json")
  expect(
    Result.isSuccess(validateClaimArtifact({ ...claimed(), prepared: artifact }))
  ).toBe(true)
})
