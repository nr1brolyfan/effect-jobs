import { Effect, Exit, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../src/Job.js"

it("reads each contract option only at execution and takes fresh frozen snapshots", () => {
  const reads = { name: 0, version: 0, payload: 0 }
  let name = "before"
  let version = 1
  const options = {
    get name() {
      reads.name++
      return name
    },
    get version() {
      reads.version++
      return version
    },
    get payload() {
      reads.payload++
      return Schema.String
    }
  }
  const setup = Job.make(options)
  expect(Effect.isEffect(setup)).toBe(true)
  expect(Object.values(reads)).toEqual([0, 0, 0])
  name = "after"
  version = 2
  const first = Effect.runSync(setup)
  expect(first).toEqual({ name: "after", version: 2, payload: Schema.String })
  expect(Object.values(reads)).toEqual([1, 1, 1])
  name = "next"
  version = 3
  const second = Effect.runSync(setup)
  expect(second).toEqual({ name: "next", version: 3, payload: Schema.String })
  expect(first.name).toBe("after")
  expect(second).not.toBe(first)
  expect(Object.values(reads)).toEqual([2, 2, 2])
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(options)).toBe(false)
})

it("preserves getter defects rather than misclassifying them as invalid configuration", () => {
  const defect = new Error("synthetic caller getter")
  const pending = Job.make({
    get name(): string {
      throw defect
    },
    payload: Schema.String
  })
  const exit = Effect.runSyncExit(pending)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toEqual([expect.objectContaining({ _tag: "Die", defect })])
  }
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
        expect(reason.error.expected).toBe("name, version and payload Schema only")
      }
    }
  }
)

it("revalidates on every execution and recovers after caller configuration is corrected", () => {
  const options = { name: "invoice.send", payload: Schema.String, version: 1 }
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
