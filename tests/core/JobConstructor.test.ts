import { Effect, Exit, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Queue from "../../src/JobQueue.js"
import type { JobPayloadEncoder } from "../../src/JobContract.js"

const queue = Queue.make("billing")

it("reads each option once during execution and creates a fresh definition per run", () => {
  const reads = {
    name: 0,
    queue: 0,
    payload: 0,
    version: 0,
    defaultPolicy: 0,
    encodePayload: 0
  }
  let nextName = "invoice.send"
  let nextVersion = 2
  let encodes = 0
  const encode: JobPayloadEncoder = () =>
    Effect.sync(() => {
      encodes++
      return {
        formatVersion: 1,
        payloadBytes: new Uint8Array(),
        semanticProjectionBytes: new Uint8Array()
      }
    })
  const options = {
    get name() {
      reads.name++
      return nextName
    },
    get queue() {
      reads.queue++
      return queue
    },
    get payload() {
      reads.payload++
      return Schema.String
    },
    get version() {
      reads.version++
      return nextVersion++
    },
    get defaultPolicy() {
      reads.defaultPolicy++
      return Policy.defaultPolicy
    },
    get encodePayload() {
      reads.encodePayload++
      return encode
    }
  }
  const setup = Job.make(options)
  expect(Object.values(reads)).toEqual([0, 0, 0, 0, 0, 0])
  expect(Effect.isEffect(setup)).toBe(true)
  nextName = "invoice.ready"
  const first = Effect.runSync(setup)
  expect(first.name).toBe("invoice.ready")
  expect(first.version).toBe(2)
  expect(first.catalog).toEqual({ queue: "billing", name: "invoice.ready", version: 2 })
  expect(Object.values(reads)).toEqual([1, 1, 1, 1, 1, 1])
  nextName = "invoice.next"
  const second = Effect.runSync(setup)
  expect(second.name).toBe("invoice.next")
  expect(second.version).toBe(3)
  expect(first.name).toBe("invoice.ready")
  expect(second).not.toBe(first)
  expect(second.catalog).not.toBe(first.catalog)
  expect(second.defaultPolicy).not.toBe(first.defaultPolicy)
  expect(Object.values(reads)).toEqual([2, 2, 2, 2, 2, 2])
  expect(encodes).toBe(0)
  expect(Object.isFrozen(options)).toBe(false)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.catalog)).toBe(true)
})

it("snapshots all policy branches at execution without freezing caller-owned values", () => {
  const policy = {
    ...Policy.defaultPolicy,
    retrySchedule: { ...Policy.defaultPolicy.retrySchedule },
    completedRetention: { ...Policy.defaultPolicy.completedRetention },
    deadRetention: { ...Policy.defaultPolicy.deadRetention }
  }
  const setup = Job.make({
    queue,
    name: "invoice.send",
    payload: Schema.String,
    defaultPolicy: policy
  })
  policy.retrySchedule.delayMillis = 6000
  policy.maxAttempts = 4
  const first = Effect.runSync(setup)
  policy.retrySchedule.delayMillis = 7000
  policy.maxAttempts = 5
  const second = Effect.runSync(setup)
  expect(first.defaultPolicy.retrySchedule.delayMillis).toBe(6000)
  expect(first.defaultPolicy.maxAttempts).toBe(4)
  expect(second.defaultPolicy.retrySchedule.delayMillis).toBe(7000)
  expect(second.defaultPolicy.maxAttempts).toBe(5)
  for (const part of ["retrySchedule", "completedRetention", "deadRetention"] as const) {
    expect(first.defaultPolicy[part]).not.toBe(policy[part])
    expect(second.defaultPolicy[part]).not.toBe(first.defaultPolicy[part])
    expect(Object.isFrozen(first.defaultPolicy[part])).toBe(true)
    expect(Object.isFrozen(policy[part])).toBe(false)
  }
  expect(Object.isFrozen(first.defaultPolicy)).toBe(true)
  expect(Object.isFrozen(policy)).toBe(false)
})

it.each([
  { name: "PRIVATE invalid name" },
  { version: 0 },
  { version: 32768 },
  { version: Number.NaN },
  { payload: { privateValue: "PRIVATE payload" } as never },
  { defaultPolicy: { privateValue: "PRIVATE policy" } as never }
])(
  "fails invalid configuration in the typed channel without exposing input",
  (invalid) => {
    const setup = Job.make({
      queue,
      name: "invoice.send",
      payload: Schema.String,
      ...invalid
    })
    expect(Effect.isEffect(setup)).toBe(true)
    const result = Effect.runSyncExit(setup)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons).toHaveLength(1)
      const reason = result.cause.reasons[0]!
      expect(reason._tag).toBe("Fail")
      if (reason._tag === "Fail") {
        expect(reason.error).toBeInstanceOf(Job.InvalidJobDefinition)
        expect(Object.keys(reason.error).sort()).toEqual(["_tag", "expected"])
        expect(JSON.stringify(reason.error)).not.toContain("PRIVATE")
        expect(reason.error.expected).toBe(
          invalid.defaultPolicy === undefined
            ? "valid queue/name/version and payload Schema"
            : "complete valid defaultPolicy"
        )
      }
    }
  }
)

it("revalidates on every execution and recovers after caller configuration is corrected", () => {
  const options = { queue, name: "invoice.send", payload: Schema.String, version: 1 }
  const setup = Job.make(options)
  options.version = 0
  const rejected = Effect.runSyncExit(setup)
  expect(Exit.isFailure(rejected)).toBe(true)
  if (Exit.isFailure(rejected)) {
    expect(rejected.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
  }
  options.version = 2
  expect(Effect.runSync(setup).version).toBe(2)
})
