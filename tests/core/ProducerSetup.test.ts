import { Effect, Exit, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import { JobDeclarationError } from "../../src/JobIdentity.js"

const job = Effect.runSync(
  Job.make({
    queue: Queue.make("setup"),
    name: "setup.run",
    payload: Schema.String
  })
)

it("reads producer options at execution and creates independent frozen snapshots on reexecution", () => {
  let operationReads = 0
  let slotsReads = 0
  let slotReads = 0
  let operation = "setup.before"
  let selected = job
  const slots = {
    get execute() {
      slotReads++
      return selected
    }
  }
  const options = {
    get operation() {
      operationReads++
      return operation
    },
    get slots() {
      slotsReads++
      return slots
    }
  }
  const setup = Producer.make(options)
  expect(Effect.isEffect(setup)).toBe(true)
  expect([operationReads, slotsReads, slotReads]).toEqual([0, 0, 0])
  operation = "setup.first"
  const first = Effect.runSync(setup)
  expect([operationReads, slotsReads, slotReads]).toEqual([1, 1, 1])
  expect(first.operation).toBe("setup.first")
  expect(first.slots.execute).toBe(job)
  selected = { ...job }
  operation = "setup.second"
  const second = Effect.runSync(setup)
  expect([operationReads, slotsReads, slotReads]).toEqual([2, 2, 2])
  expect(second).not.toBe(first)
  expect(second.slots).not.toBe(first.slots)
  expect(second.slots.execute).toBe(selected)
  expect(first.slots.execute).toBe(job)
  expect(first.operation).toBe("setup.first")
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.slots)).toBe(true)
  expect(Object.isFrozen(options)).toBe(false)
  expect(Object.isFrozen(slots)).toBe(false)
})

it.each([
  [{ operation: "Bad", slots: { execute: job } }, "operation"],
  [{ operation: "setup.run", slots: {} }, "slots"],
  [{ operation: "setup.run", slots: null }, "slots"],
  [{ operation: "setup.run", slots: [] }, "slots"],
  [{ operation: "setup.run", slots: { Bad: job } }, "slots[0]"],
  [{ operation: "setup.run", slots: { execute: null } }, "slots"]
] as const)("keeps invalid producer setup in Fail: %j", (options, field) => {
  const pending = Producer.make(options as never)
  expect(Effect.isEffect(pending)).toBe(true)
  const exit = Effect.runSyncExit(pending)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
  }
  expect(Effect.runSync(Effect.flip(pending))).toBeInstanceOf(JobDeclarationError)
  expect(Effect.runSync(Effect.flip(pending))).toMatchObject({ field })
})

it("revalidates changed options on each run without altering an exposed declaration", () => {
  const options = { operation: "setup.run", slots: { execute: job } }
  const setup = Producer.make(options)
  const first = Effect.runSync(setup)
  options.operation = "invalid operation"
  expect(Effect.runSync(Effect.flip(setup))).toMatchObject({
    _tag: "JobDeclarationError",
    field: "operation",
    value: "invalid operation"
  })
  expect(first.operation).toBe("setup.run")
  expect(first.slots.execute).toBe(job)
})

it("preserves caller getter defects without mapping them into expected setup errors", () => {
  const defect = new Error("synthetic caller getter")
  const setup = Producer.make({
    get operation(): string {
      throw defect
    },
    slots: { execute: job }
  })
  const exit = Effect.runSyncExit(setup)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Die"])
    const reason = exit.cause.reasons[0]!
    if (reason._tag === "Die") {
      expect(reason.defect).toBe(defect)
    }
  }
})
