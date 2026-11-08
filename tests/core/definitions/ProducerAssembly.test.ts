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
const job = Job.make({ kind: "email.send", payload: Schema.String })
const jobId = Schema.decodeSync(JobId)("assembly-result")

describe("immutable pipeable producer assembly", () => {
  it("permits empty declarations and branches without changing earlier producers", () => {
    const empty = Producer.make("campaign.deliver")
    const emails = empty.pipe(Producer.withSlot("email", job, { queue }))
    const both = emails.pipe(Producer.withSlot("audit", job, { queue }))
    const alternative = empty.pipe(Producer.withSlot("sms", job, { queue }))
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
    const contract = { ...job, kind: job.kind as string }
    const destination = { ...queue }
    const policy = {
      ...Policy.defaultPolicy,
      retrySchedule: { ...Policy.defaultPolicy.retrySchedule },
      completedRetention: { ...Policy.defaultPolicy.completedRetention },
      deadRetention: { ...Policy.defaultPolicy.deadRetention }
    }
    const options = { queue: destination, policy }
    const bind = Producer.withSlot("email", contract, options)
    const first = Producer.make("campaign.first").pipe(bind)
    contract.kind = "email.changed"
    destination.name = "priority" as typeof destination.name
    policy.retrySchedule.delayMillis = 100
    const second = Producer.make("campaign.second").pipe(bind)
    expect(first.slots.email.job.kind).toBe("email.send")
    expect(first.slots.email.queue.name).toBe("emails")
    expect(first.slots.email.policy.retrySchedule.delayMillis).toBe(5000)
    expect(second.slots.email.job.kind).toBe("email.changed")
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
    const producer = Producer.make("campaign.deliver").pipe(
      Producer.withSlot("email", job, { queue })
    )
    const dynamicName: string = "email"
    expect(() =>
      producer.pipe(
        Producer.withSlot(dynamicName, job, {
          queue: Queue.make("priority")
        })
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
    expect(() => Producer.make(name)).toThrow(JobDeclarationError)
    expect(() =>
      Producer.make("valid").pipe(Producer.withSlot(name, job, { queue }))
    ).toThrow(JobDeclarationError)
  })

  it.each([
    { job: { ...job, kind: "Bad" }, queue, field: "job" },
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
      Producer.make("valid").pipe(Producer.withSlot("email", input.job, input))
    ).toThrow(
      expect.objectContaining({
        _tag: "InvalidProducerBinding",
        slot: "email",
        field: input.field
      })
    )
  })

  it("does not expose a compatibility record constructor", () => {
    expect(() => Producer.make({ operation: "valid", slots: {} } as never)).toThrow(
      JobDeclarationError
    )
  })

  it("rejects runtime enqueue on an empty declaration on all three paths", async () => {
    const empty = Producer.make("campaign.deliver")
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
