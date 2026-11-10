import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Policy from "../../../src/JobPolicy.js"
import { EnqueueResults, type PreparedJob } from "../../../src/JobContract.js"
import { JobEnqueue } from "../../../src/JobEnqueue.js"
import { JobId } from "../../../src/JobId.js"
import { JobDeclarationError } from "../../../src/JobIdentity.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"

const queue = Queue.make("billing")
const id = Schema.decodeSync(JobId)("first")
const identity = { operation: "invoice.create", operationId: "one", slot: "delivery" }
const input = { producer: identity, payload: "synthetic" }
const result = EnqueueResults.Inserted({ jobId: id })
const capture = (seen: Array<PreparedJob>) =>
  JobEnqueue.of({
    enqueue: (prepared) =>
      Effect.flatMap(prepared, (value) => {
        seen.push(value)
        return Effect.succeed(result)
      }),
    enqueueStandalone: (prepared) =>
      Effect.flatMap(prepared, (value) => {
        seen.push(value)
        return Effect.succeed(result)
      })
  })

describe("bound production and defaults", () => {
  it("snapshots caller defaults, applies whole overrides and resolves all entrypoints identically", async () => {
    const mutable = {
      ...Policy.defaultPolicy,
      retrySchedule: { ...Policy.defaultPolicy.retrySchedule }
    }
    const job = Job.make({
      name: "invoice.send",
      queue,
      payload: Schema.String,
      defaultPolicy: mutable
    })
    mutable.retrySchedule.delayMillis = 17
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(Object.isFrozen(mutable.retrySchedule)).toBe(false)
    expect(job.defaultPolicy?.retrySchedule.delayMillis).toBe(5000)
    expect(Object.isFrozen(job.defaultPolicy)).toBe(true)
    const bindings = { delivery: job, copy: job }
    const producer = Producer.make({ operation: identity.operation, slots: bindings })
    bindings.delivery = { ...job }
    expect(producer.slots.delivery).toBe(job)
    expect(Object.isFrozen(producer.slots)).toBe(true)
    const seen: Array<PreparedJob> = []
    const override = Policy.make({ maxAttempts: 1 })
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* job.enqueue(input)
        yield* job.enqueueStandalone({ ...input, policy: override })
        yield* producer.enqueue("copy", {
          operationId: "one",
          payload: "another recipient"
        })
        yield* withJoinedTransaction(
          (prepared) => {
            seen.push(prepared)
            return Effect.succeed(result)
          },
          (tx) => job.enqueueInTransaction(tx, input)
        )
      }).pipe(Effect.provideService(JobEnqueue, capture(seen)))
    )
    expect(seen.map((p) => p.policy.maxAttempts)).toEqual([3, 1, 3, 3])
    expect(seen[0]!.policy.retrySchedule.delayMillis).toBe(5000)
    expect(seen[2]!.producer).toEqual({ ...identity, slot: "copy" })
    expect(seen.every((p) => p.catalog.name === "invoice.send")).toBe(true)
  })
  it("keeps different queues and the same contract under several slots", async () => {
    const first = Job.make({
      name: "invoice.send",
      queue,
      payload: Schema.String,
      defaultPolicy: Policy.defaultPolicy
    })
    const second = Job.make({
      name: "confirmation.send",
      queue: Queue.make("mail"),
      payload: Schema.Int,
      defaultPolicy: Policy.defaultPolicy
    })
    const producer = Producer.make({
      operation: "order.place",
      slots: { invoice: first, copy: first, confirmation: second }
    })
    const seen: Array<PreparedJob> = []
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* producer.enqueue("invoice", { operationId: "one", payload: "recipient" })
        yield* producer.enqueue("confirmation", { operationId: "one", payload: 1 })
      }).pipe(Effect.provideService(JobEnqueue, capture(seen)))
    )
    expect(seen.map((p) => p.catalog.queue)).toEqual(["billing", "mail"])
  })
  it("rejects invalid declarations and dynamic missing/invalid policies at their boundaries", async () => {
    expect(() =>
      Job.make({
        name: "invoice.send",
        queue,
        payload: Schema.String,
        defaultPolicy: {} as never
      })
    ).toThrow(Job.InvalidJobDefinition)
    expect(() => Producer.make({ operation: "order.place", slots: {} })).toThrow(
      JobDeclarationError
    )
    expect(() =>
      Producer.make({ operation: "order.place", slots: { delivery: null } } as never)
    ).toThrow(JobDeclarationError)
    const job = Job.make({ name: "invoice.send", queue, payload: Schema.String })
    const seen: Array<PreparedJob> = []
    const failure = await Effect.runPromise(
      Effect.flip(job.enqueue(input as never)).pipe(
        Effect.provideService(JobEnqueue, capture(seen))
      )
    )
    expect(failure).toMatchObject({ _tag: "InvalidJobInput", field: "policy" })
    const producer = Producer.make({ operation: "order.place", slots: { delivery: job } })
    for (const args of [
      ["unknown", { operationId: "one", payload: "input", policy: Policy.defaultPolicy }],
      ["delivery", { operationId: "", payload: "input", policy: Policy.defaultPolicy }]
    ] as const) {
      const rejected = await Effect.runPromise(
        Effect.flip(producer.enqueue(args[0] as "delivery", args[1])).pipe(
          Effect.provideService(JobEnqueue, capture(seen))
        )
      )
      expect(rejected).toMatchObject({ _tag: "InvalidJobInput", field: "producer" })
    }
    expect(seen).toEqual([])
  })
})
