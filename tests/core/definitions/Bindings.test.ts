import * as Retry from "../../../src/JobRetryPolicy.js"
import { Duration, Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Policy from "../../../src/JobPolicy.js"
import { EnqueueResult, type PreparedJob } from "../../../src/JobContract.js"
import { JobEnqueue } from "../../../src/JobEnqueue.js"
import { JobId } from "../../../src/JobId.js"
import { JobDeclarationError } from "../../../src/JobIdentity.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"

const queue = Queue.make("billing")
const id = Schema.decodeSync(JobId)("first")
const identity = { operation: "invoice.create", operationId: "one", slot: "delivery" }
const input = {
  slot: "delivery" as const,
  operationId: identity.operationId,
  payload: "synthetic"
}
const result = EnqueueResult.Inserted({ jobId: id })
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
    const job = Effect.runSync(
      Job.make({
        name: "invoice.send",
        payload: Schema.String
      })
    )
    const bindings = {
      delivery: { job, queue, policy: mutable },
      copy: { job, queue, policy: mutable }
    }
    const producer = Effect.runSync(
      Producer.make(identity.operation).pipe(
        Producer.withSlot("delivery", bindings.delivery.job, bindings.delivery),
        Producer.withSlot("copy", bindings.copy.job, bindings.copy)
      )
    )
    mutable.retrySchedule.delayMillis = 17
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(Object.isFrozen(mutable.retrySchedule)).toBe(false)
    expect(producer.slots.delivery.policy.retrySchedule.delayMillis).toBe(5000)
    expect(Object.isFrozen(producer.slots.delivery.policy)).toBe(true)
    bindings.delivery = { job: { ...job }, queue, policy: mutable }
    expect(producer.slots.delivery.job).not.toBe(bindings.delivery.job)
    expect(Object.isFrozen(producer.slots)).toBe(true)
    const seen: Array<PreparedJob> = []
    const override = Effect.runSync(
      Policy.make({
        retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxFinalizedAttempts(1))
      })
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* producer.enqueue(input)
        yield* producer.enqueueStandalone({ ...input, policy: override })
        yield* producer.enqueue({
          slot: "copy",
          operationId: "one",
          payload: "another recipient"
        })
        yield* withJoinedTransaction(
          (prepared) => {
            seen.push(prepared)
            return Effect.succeed(result)
          },
          (tx) => producer.enqueueInTransaction(tx, input)
        )
      }).pipe(Effect.provideService(JobEnqueue, capture(seen)))
    )
    expect(seen.map((p) => p.policy.maxFinalizedAttempts)).toEqual([3, 1, 3, 3])
    expect(seen[0]!.policy.retrySchedule.delayMillis).toBe(5000)
    expect(seen[2]!.producer).toEqual({ ...identity, slot: "copy" })
    expect(seen.every((p) => p.catalog.name === "invoice.send")).toBe(true)
  })
  it("keeps different queues and the same contract under several slots", async () => {
    const first = Effect.runSync(
      Job.make({
        name: "invoice.send",
        payload: Schema.String
      })
    )
    const second = Effect.runSync(
      Job.make({
        name: "confirmation.send",
        payload: Schema.Int
      })
    )
    const producer = Effect.runSync(
      Producer.make("order.place").pipe(
        Producer.withSlot("invoice", first, { queue }),
        Producer.withSlot("copy", first, { queue }),
        Producer.withSlot("confirmation", second, { queue: Queue.make("mail") })
      )
    )
    const seen: Array<PreparedJob> = []
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* producer.enqueue({
          slot: "invoice",
          operationId: "one",
          payload: "recipient"
        })
        yield* producer.enqueue({ slot: "confirmation", operationId: "one", payload: 1 })
      }).pipe(Effect.provideService(JobEnqueue, capture(seen)))
    )
    expect(seen.map((p) => p.catalog.queue)).toEqual(["billing", "mail"])
  })
  it("rejects invalid declarations and invalid policies at their boundaries", async () => {
    const job = Effect.runSync(Job.make({ name: "invoice.send", payload: Schema.String }))
    expect(
      Effect.runSync(
        Effect.flip(
          Producer.make("order.place").pipe(
            Producer.withSlot("delivery", job, { queue, policy: {} as never })
          )
        )
      )
    ).toBeInstanceOf(Producer.InvalidProducerBinding)
    expect(Effect.runSync(Effect.flip(Producer.make("Bad")))).toBeInstanceOf(
      JobDeclarationError
    )
    expect(
      Effect.runSync(
        Effect.flip(
          Producer.make("order.place").pipe(
            Producer.withSlot("delivery", null as never, { queue })
          )
        )
      )
    ).toBeInstanceOf(Producer.InvalidProducerBinding)
    const producer = Effect.runSync(
      Producer.make("order.place").pipe(Producer.withSlot("delivery", job, { queue }))
    )
    const seen: Array<PreparedJob> = []
    const failure = await Effect.runPromise(
      Effect.flip(producer.enqueue({ ...input, policy: {} as never })).pipe(
        Effect.provideService(JobEnqueue, capture(seen))
      )
    )
    expect(failure).toMatchObject({ _tag: "InvalidJobInput", field: "policy" })
    for (const args of [
      { slot: "unknown", operationId: "one", payload: "input" },
      { slot: "delivery", operationId: "", payload: "input" }
    ] as const) {
      const rejected = await Effect.runPromise(
        Effect.flip(producer.enqueue(args as never)).pipe(
          Effect.provideService(JobEnqueue, capture(seen))
        )
      )
      expect(rejected).toMatchObject(
        args.operationId === ""
          ? { _tag: "InvalidOperationId" }
          : { _tag: "InvalidJobInput", field: "producer" }
      )
    }
    expect(seen).toEqual([])
  })
})
