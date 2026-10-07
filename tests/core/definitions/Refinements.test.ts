import { Duration, Effect, Result, Schema } from "effect"
import { it, expect } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Codes from "../../../src/FailureCode.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"
import { EnqueueResults, type EncodedJobPayload } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"

it("deeply immutable defaults do not freeze or alter caller options", () => {
  expect(Policy.defaultPolicy).toEqual(Policy.make())
  for (const part of [
    Policy.defaultPolicy,
    Policy.defaultPolicy.retrySchedule,
    Policy.defaultPolicy.completedRetention,
    Policy.defaultPolicy.deadRetention
  ]) {
    expect(Object.isFrozen(part)).toBe(true)
  }
  expect(() =>
    Object.assign(Policy.defaultPolicy.retrySchedule, { delayMillis: 1 })
  ).toThrow(TypeError)
  const duration = Duration.seconds(8)
  const options = { maxAttempts: 5, retryDelay: duration }
  expect(Policy.make(options).maxAttempts).toBe(5)
  expect(Object.isFrozen(options)).toBe(false)
  expect(Object.isFrozen(duration)).toBe(false)
  options.maxAttempts = 6
  expect(Policy.defaultPolicy.maxAttempts).toBe(3)
})
it("validated catalogs and nonthrowing parser share 128-character storage boundaries", () => {
  const codes = Codes.define({ boundary: "a".repeat(128), historic: "old_catalog_code" })
  expect(Object.isFrozen(codes)).toBe(true)
  expect(JobFailures.Retry({ code: codes.boundary }).code).toHaveLength(128)
  expect(Schema.decodeSync(Codes.FailureCode)("different_deployment_code")).toBe(
    "different_deployment_code"
  )
  for (const value of ["a".repeat(129), "", "a\n", "a\r", "Bad", "private message"]) {
    const parsed = Codes.parse(value)
    expect(Result.isFailure(parsed)).toBe(true)
    expect(() => Codes.define({ offendingEntry: value })).toThrow(
      Codes.InvalidFailureCode
    )
    if (Result.isFailure(parsed)) {
      expect(JSON.stringify(parsed.failure)).not.toContain(
        value === "" ? "no-secret" : value
      )
    }
  }
  expect(() => Codes.define({ privateEntry: "SECRET value" })).toThrow(/privateEntry/)
})
it("omitted version and standard encoder match explicit values; custom override remains explicit", async () => {
  const base = {
    queue: Queue.make("billing"),
    kind: "receipt",
    payload: Schema.Struct({ invoiceId: Schema.String })
  }
  const a = Job.make(base)
  const b = Job.make({ ...base, version: 1, encodePayload: encodeJobPayload })
  expect(a.catalog).toEqual(b.catalog)
  expect(Job.make({ ...base, version: 2 }).version).toBe(2)
  for (const version of [0, -1, 1.5, 32768, NaN]) {
    expect(() => Job.make({ ...base, version })).toThrow(Job.InvalidJobDefinition)
  }
  const input = {
    producer: { operation: "billing.issue", operationId: "id", slot: "receipt" },
    policy: Policy.defaultPolicy,
    payload: { invoiceId: "public" }
  }
  const artifacts: EncodedJobPayload[] = []
  const insert = (job: Job.JobDefinition<typeof base.payload>) =>
    withJoinedTransaction(
      (prepared) =>
        Effect.sync(() => {
          artifacts.push(prepared.encoded)
          return EnqueueResults.Inserted({ jobId: Schema.decodeSync(JobId)("job") })
        }),
      (tx) => job.enqueueInTransaction(tx, input)
    )
  await Effect.runPromise(insert(a))
  await Effect.runPromise(insert(b))
  expect(artifacts[0]).toEqual(artifacts[1])
  let calls = 0
  const custom = Job.make({
    ...base,
    encodePayload: (schema, value) => {
      calls++
      return encodeJobPayload(schema, value)
    }
  })
  await Effect.runPromise(insert(custom))
  expect(calls).toBe(1)
})
