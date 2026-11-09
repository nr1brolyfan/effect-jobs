import * as FailureCodes from "../../src/FailureCode.js"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { JobId } from "../../src/JobId.js"
import { JobFailures, JobFailure, InvalidJobFailure } from "../../src/JobFailure.js"
import * as Contract from "../../src/JobContract.js"
import { maximumMillis } from "../../src/JobPolicy.js"
import { finalizationFromFailure, JobFinalization } from "../../src/JobLifecycle.js"

it("returns the same branded ID for inserted and matching existing jobs", () => {
  const jobId = Schema.decodeSync(JobId)("opaque-id")
  expect(Contract.EnqueueResult.Inserted({ jobId })).toEqual({ _tag: "Inserted", jobId })
  expect(Contract.EnqueueResult.AlreadyPresent({ jobId }).jobId).toBe(jobId)
  expect(Schema.is(JobId)("")).toBe(false)
})
it("retains distinct validated handler outcome values", () => {
  for (const outcome of [
    JobFailures.Retry({
      code: FailureCodes.define({ value: "temporary" }).value,
      retryBefore: maximumMillis
    }),
    JobFailures.Dead({ code: FailureCodes.define({ value: "rejected" }).value }),
    JobFailures.Isolate({ code: FailureCodes.define({ value: "invalid" }).value }),
    JobFailures.OutcomeUnknown({
      code: FailureCodes.define({ value: "response_lost" }).value
    })
  ]) {
    expect(Schema.is(JobFailure)(outcome)).toBe(true)
    expect(Object.isFrozen(outcome)).toBe(true)
  }
  expect(
    JobFailures.Retry({
      code: FailureCodes.define({ value: "a".repeat(128) }).value,
      retryBefore: 1
    })._tag
  ).toBe("Retry")
})
it.each(["", "A", "message with secrets", "a".repeat(129), "a\n"])(
  "rejects invalid failure codes without retaining messages",
  (code) => {
    expect(() => FailureCodes.define({ value: code })).toThrow(
      FailureCodes.InvalidFailureCode
    )
  }
)
it.each([0, -1, 0.5, maximumMillis + 1, Infinity, NaN])(
  "rejects invalid retry cutoffs",
  (retryBefore) => {
    const make = () =>
      JobFailures.Retry({
        code: FailureCodes.define({ value: "temporary" }).value,
        retryBefore
      })
    expect(make).toThrow(InvalidJobFailure)
    expect(make).toThrow(expect.objectContaining({ field: "retryBefore" }))
  }
)
it("preserves retryBefore through the worker failure adapter and rejects the removed spelling", () => {
  const code = FailureCodes.define({ value: "temporary" }).value
  const failure = JobFailures.Retry({ code, retryBefore: 1000 })
  expect(finalizationFromFailure(failure)).toMatchObject({
    _tag: "Success",
    success: { _tag: "Retry", code, retryBefore: 1000 }
  })
  const removed = { _tag: "Retry", code, notAfter: 1000 }
  for (const schema of [JobFailure, JobFinalization]) {
    expect(
      Schema.decodeUnknownResult(schema, { onExcessProperty: "error" })(removed)
    ).toMatchObject({ _tag: "Failure" })
  }
  expect(finalizationFromFailure(removed)).toMatchObject({ _tag: "Failure" })
})
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
