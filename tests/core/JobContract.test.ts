import { Schema } from "effect"
import { expect, it } from "vitest"
import { JobId } from "../../src/JobId.js"
import { JobFailures, JobFailure, InvalidJobFailure } from "../../src/JobFailure.js"
import * as Contract from "../../src/JobContract.js"
import { maximumMillis } from "../../src/JobPolicy.js"

it("returns the same branded ID for inserted and matching existing jobs", () => {
  const jobId = Schema.decodeSync(JobId)("opaque-id")
  expect(Contract.EnqueueResults.Inserted({ jobId })).toEqual({ _tag: "Inserted", jobId })
  expect(Contract.EnqueueResults.AlreadyPresent({ jobId }).jobId).toBe(jobId)
  expect(Schema.is(JobId)("")).toBe(false)
})
it("retains distinct validated handler outcome values", () => {
  for (const outcome of [
    JobFailures.Retry({ code: "temporary", notAfter: maximumMillis }),
    JobFailures.Dead({ code: "rejected" }),
    JobFailures.Isolate({ code: "invalid" }),
    JobFailures.OutcomeUnknown({ code: "response_lost" })
  ]) {
    expect(Schema.is(JobFailure)(outcome)).toBe(true)
    expect(Object.isFrozen(outcome)).toBe(true)
  }
  expect(JobFailures.Retry({ code: "a".repeat(64), notAfter: 1 })._tag).toBe("Retry")
})
it.each(["", "A", "message with secrets", "a".repeat(65), "a\n"])(
  "rejects invalid failure codes without retaining messages",
  (code) => {
    for (const factory of [
      JobFailures.Retry,
      JobFailures.Dead,
      JobFailures.Isolate,
      JobFailures.OutcomeUnknown
    ]) {
      expect(() => factory({ code })).toThrow(InvalidJobFailure)
    }
  }
)
it.each([0, -1, 0.5, maximumMillis + 1, Infinity, NaN])(
  "rejects invalid retry cutoffs",
  (notAfter) => {
    expect(() => JobFailures.Retry({ code: "temporary", notAfter })).toThrow(
      InvalidJobFailure
    )
  }
)
it("freezes accepted codec bounds without claiming a codec implementation", () => {
  expect([
    Contract.jobPayloadFormatVersion,
    Contract.maximumJobPayloadBytes,
    Contract.maximumJobSemanticProjectionBytes,
    Contract.maximumJobPayloadDepth,
    Contract.maximumProtectedJobPayloadSubtrees,
    Contract.maximumJobPayloadSchemaPathBytes
  ]).toEqual([1, 65_536, 65_536, 32, 16, 256])
  expect(Object.keys(new Contract.JobIntegrityConflict())).not.toContain("payload")
})
