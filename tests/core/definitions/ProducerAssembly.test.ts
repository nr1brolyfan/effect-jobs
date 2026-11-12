import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Policy from "../../../src/JobPolicy.js"
import { JobDeclarationError } from "../../../src/JobIdentity.js"
import { JobEnqueue } from "../../../src/JobEnqueue.js"
import { EnqueueResult, type PreparedJob } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"

const queue = Queue.make("emails")
const job = Effect.runSync(Job.make({ name: "email.send", payload: Schema.String }))
const jobId = Schema.decodeSync(JobId)("assembly-result")

describe("immutable pipeable producer assembly", () => {
  it("permits empty declarations and branches without changing earlier producers", () => {
    const empty = Effect.runSync(Producer.make("campaign.deliver"))
    const emails = Effect.runSync(
      Effect.succeed(empty).pipe(Producer.withSlot("email", job, { queue }))
    )
    const both = Effect.runSync(
      Effect.succeed(emails).pipe(Producer.withSlot("audit", job, { queue }))
    )
    const alternative = Effect.runSync(
      Effect.succeed(empty).pipe(Producer.withSlot("sms", job, { queue }))
    )
    expect(empty.operation).toBe("campaign.deliver")
    expect(Object.keys(empty.slots)).toEqual([])
    expect(Object.keys(emails.slots)).toEqual(["email"])
    expect(Object.keys(both.slots)).toEqual(["email", "audit"])
    expect(Object.keys(alternative.slots)).toEqual(["sms"])
    expect(both.slots.email).toBe(emails.slots.email)
    for (const producer of [empty, emails, both, alternative]) {
      expect(Object.isFrozen(producer)).toBe(true)
      expect(Object.isFrozen(producer.slots)).toBe(true)
      expect(producer).not.toHaveProperty("build")
      expect(producer).not.toHaveProperty("replaceSlot")
    }
  })

  it("snapshots on application and reuses a combinator without sharing mutable caller config", () => {
    const contract = { ...job, name: job.name as string }
    const destination = { ...queue }
    const policy = {
      ...Policy.defaultPolicy,
      retrySchedule: { ...Policy.defaultPolicy.retrySchedule },
      completedRetention: { ...Policy.defaultPolicy.completedRetention },
      deadRetention: { ...Policy.defaultPolicy.deadRetention }
    }
    const options = { queue: destination, policy }
    const bind = Producer.withSlot("email", contract, options)
    const first = Effect.runSync(Producer.make("campaign.first").pipe(bind))
    contract.name = "email.changed"
    destination.name = "priority" as typeof destination.name
    policy.retrySchedule.delayMillis = 100
    const second = Effect.runSync(Producer.make("campaign.second").pipe(bind))
    expect(first.slots.email.job.name).toBe("email.send")
    expect(first.slots.email.queue.name).toBe("emails")
    expect(first.slots.email.policy.retrySchedule.delayMillis).toBe(5000)
    expect(second.slots.email.job.name).toBe("email.changed")
    expect(second.slots.email.queue.name).toBe("priority")
    expect(second.slots.email.policy.retrySchedule.delayMillis).toBe(100)
    for (const value of [contract, destination, policy, policy.retrySchedule, options]) {
      expect(Object.isFrozen(value)).toBe(false)
    }
    for (const value of [
      first.slots.email,
      first.slots.email.job,
      first.slots.email.queue,
      first.slots.email.policy,
      first.slots.email.policy.retrySchedule,
      first.slots.email.policy.completedRetention,
      first.slots.email.policy.deadRetention
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
  })

  it("rejects runtime duplicates without modifying the first binding", () => {
    const producer = Effect.runSync(
      Producer.make("campaign.deliver").pipe(Producer.withSlot("email", job, { queue }))
    )
    const dynamicName: string = "email"
    expect(() =>
      Effect.runSync(
        Effect.succeed(producer).pipe(
          Producer.withSlot(dynamicName, job, {
            queue: Queue.make("priority")
          })
        )
      )
    ).toThrow(
      expect.objectContaining({
        _tag: "JobDeclarationError",
        field: "slots[1]",
        value: "email",
        expected: "unique declared slot"
      })
    )
    expect(producer.slots.email.queue.name).toBe("emails")
    expect(Object.keys(producer.slots)).toEqual(["email"])
  })

  it.each(["", "Bad", "a!", "a".repeat(129)])("rejects declaration name %j", (name) => {
    expect(() => Effect.runSync(Producer.make(name))).toThrow(JobDeclarationError)
    expect(() =>
      Effect.runSync(Producer.make("valid").pipe(Producer.withSlot(name, job, { queue })))
    ).toThrow(JobDeclarationError)
  })

  it.each([
    { job: { ...job, name: "Bad" }, queue, field: "job" },
    { job: { ...job, version: 0 }, queue, field: "job" },
    { job, queue: { ...queue, name: "Bad" }, field: "queue" },
    {
      job,
      queue,
      policy: { ...Policy.defaultPolicy, maxFinalizedAttempts: 0 },
      field: "policy"
    }
  ])("validates the new binding synchronously: $field", (input) => {
    expect(() =>
      Effect.runSync(
        Producer.make("valid").pipe(Producer.withSlot("email", input.job, input))
      )
    ).toThrow(
      expect.objectContaining({
        _tag: "InvalidProducerBinding",
        slot: "email",
        field: input.field
      })
    )
  })

  it("does not expose a compatibility record constructor", () => {
    expect(() =>
      Effect.runSync(Producer.make({ operation: "valid", slots: {} } as never))
    ).toThrow(JobDeclarationError)
  })

  it("rejects runtime enqueue on an empty declaration on all three paths", async () => {
    const empty = Effect.runSync(Producer.make("campaign.deliver"))
    const input = { slot: "email", operationId: "one", payload: "private" } as never
    const prepared: PreparedJob[] = []
    const insert = (value: PreparedJob) =>
      Effect.sync(() => {
        prepared.push(value)
        return EnqueueResult.Inserted({ jobId })
      })
    const enqueueService = JobEnqueue.of({
      enqueue: (prepare) => Effect.flatMap(prepare, insert),
      enqueueStandalone: (prepare) => Effect.flatMap(prepare, insert)
    })
    const effects = [
      empty.enqueue(input).pipe(Effect.provideService(JobEnqueue, enqueueService)),
      empty
        .enqueueStandalone(input)
        .pipe(Effect.provideService(JobEnqueue, enqueueService)),
      withJoinedTransaction(insert, (tx) => empty.enqueueInTransaction(tx, input))
    ]
    for (const effect of effects) {
      expect(await Effect.runPromise(effect.pipe(Effect.result))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidJobInput", field: "producer" }
      })
    }
    expect(prepared).toHaveLength(0)
  })
})
