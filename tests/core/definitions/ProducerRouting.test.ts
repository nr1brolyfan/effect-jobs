import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Producer from "../../../src/JobProducer.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Job from "../../../src/Job.js"
import { EnqueueResult, type PreparedJob } from "../../../src/JobContract.js"
import { JobEnqueue, JobPersistenceError } from "../../../src/JobEnqueue.js"
import { JobId } from "../../../src/JobId.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"
import type { JobsTransaction } from "../../../src/JobTransaction.js"
import * as Payload from "../../../src/JobPayload.js"
import {
  Document,
  DocumentEncryption,
  keys,
  keysLayer
} from "../codec/EncryptedFixture.js"

const bulk = Queue.make("emails.bulk")
const priority = Queue.make("emails.priority")
const job = Effect.runSync(Job.make({ name: "email.send", payload: Schema.String }))
const producer = Effect.runSync(
  Producer.make("campaign.deliver").pipe(
    Producer.withSlot("fixed", job, { queue: bulk }),
    Producer.withSlot("choice", job, { queues: [bulk, priority] }),
    Producer.withSlot("single", job, { queues: [bulk] })
  )
)
const methods = ["enqueue", "enqueueStandalone", "enqueueInTransaction"] as const
const jobId = Schema.decodeSync(JobId)("route-result")

describe("fixed and explicit selectable producer routes", () => {
  it.each(methods)(
    "%s applies both routes with independent policy and availability",
    async (method) => {
      const prepared: PreparedJob[] = []
      const insert = (value: PreparedJob) =>
        Effect.sync(() => {
          prepared.push(value)
          return EnqueueResult.Inserted({ jobId })
        })
      const service = JobEnqueue.of({
        enqueue: Effect.flatMap(insert),
        enqueueStandalone: Effect.flatMap(insert)
      })
      for (const input of [
        { slot: "fixed", operationId: "private-id", payload: "private-payload" },
        {
          slot: "choice",
          operationId: "private-id",
          payload: "private-payload",
          queue: priority.name
        },
        {
          slot: "single",
          operationId: "private-id",
          payload: "private-payload",
          queue: bulk.name
        }
      ] as const) {
        for (const policy of [
          undefined,
          { ...Policy.defaultPolicy, maxFinalizedAttempts: 7 }
        ]) {
          const command = {
            ...input,
            availableAt: 1,
            ...(policy === undefined ? {} : { policy })
          }
          const effect =
            method === "enqueueInTransaction"
              ? withJoinedTransaction(insert, (tx) =>
                  producer.enqueueInTransaction(tx, command)
                )
              : producer[method](command).pipe(Effect.provideService(JobEnqueue, service))
          await Effect.runPromise(effect)
        }
      }
      expect(prepared.map((value) => value.catalog.queue)).toEqual([
        bulk.name,
        bulk.name,
        priority.name,
        priority.name,
        bulk.name,
        bulk.name
      ])
      expect(prepared.map((value) => value.policy.maxFinalizedAttempts)).toEqual([
        3, 7, 3, 7, 3, 7
      ])
      expect(prepared.every((value) => value.availableAt === 1)).toBe(true)
    }
  )

  it.each(methods)(
    "%s rejects invalid routes after authority and before encryption/insertion",
    async (method) => {
      let seals = 0
      let inserts = 0
      const payload = Effect.runSync(
        Payload.encrypted({
          schema: Document,
          codec: {
            ...DocumentEncryption,
            seal: (value) =>
              Effect.suspend(() => {
                seals++
                return DocumentEncryption.seal(value)
              })
          }
        })
      )
      const secureJob = Effect.runSync(Job.make({ name: "email.secure", payload }))
      const secure = Effect.runSync(
        Producer.make("campaign.secure").pipe(
          Producer.withSlot("fixed", secureJob, { queue: bulk }),
          Producer.withSlot("choice", secureJob, { queues: [bulk, priority] }),
          Producer.withSlot("single", secureJob, { queues: [bulk] })
        )
      )
      const insert = () =>
        Effect.sync(() => {
          inserts++
          return EnqueueResult.Inserted({ jobId })
        })
      const service = JobEnqueue.of({
        enqueue: Effect.flatMap(insert),
        enqueueStandalone: Effect.flatMap(insert)
      })
      let closed!: JobsTransaction
      await Effect.runPromise(
        withJoinedTransaction(insert, (tx) =>
          Effect.sync(() => {
            closed = tx
          })
        )
      )
      for (const routing of [
        { slot: "fixed", queue: bulk },
        { slot: "fixed", queue: bulk.name },
        { slot: "fixed", queue: priority.name },
        { slot: "fixed", queue: undefined },
        { slot: "choice" },
        { slot: "single" },
        { slot: "choice", queue: undefined },
        { slot: "choice", queue: priority },
        { slot: "choice", queue: "other" },
        { slot: "choice", queue: null },
        { slot: "single", queue: priority.name }
      ]) {
        const input = {
          ...routing,
          operationId: "private-id",
          payload: { recipient: "private-payload", total: 1n }
        } as never
        const execute =
          method === "enqueueInTransaction"
            ? withJoinedTransaction(insert, (tx) =>
                secure.enqueueInTransaction(tx, input)
              )
            : secure[method](input).pipe(Effect.provideService(JobEnqueue, service))
        const result = await Effect.runPromise(
          execute.pipe(Effect.provide(keysLayer(keys())), Effect.result)
        )
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "InvalidJobInput", field: "catalog" }
        })
        expect(JSON.stringify(result)).not.toMatch(/private-id|private-payload/)
        const denied = JobEnqueue.of({
          enqueue: () =>
            Effect.fail(
              new JobPersistenceError({
                reason: "transaction-required",
                commitKnowledge: "NotCommitted"
              })
            ),
          enqueueStandalone: () =>
            Effect.fail(
              new JobPersistenceError({
                reason: "active-transaction",
                commitKnowledge: "NotCommitted"
              })
            )
        })
        const unauthorized =
          method === "enqueueInTransaction"
            ? secure.enqueueInTransaction(closed, input)
            : secure[method](input).pipe(Effect.provideService(JobEnqueue, denied))
        expect(
          await Effect.runPromise(
            unauthorized.pipe(Effect.provide(keysLayer(keys())), Effect.result)
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag:
              method === "enqueueInTransaction"
                ? "JobsTransactionClosed"
                : "JobPersistenceError"
          }
        })
      }
      expect(seals).toBe(0)
      expect(inserts).toBe(0)
    }
  )

  it.each([
    {},
    { queue: bulk, queues: [priority] },
    { queues: [] },
    { queues: [bulk, bulk] },
    { queues: [bulk, { ...bulk }] },
    { queues: [null] },
    { queues: null },
    { queue: undefined },
    { queues: [{ name: "Invalid/name" }] },
    { queue: bulk, defaultQueue: bulk },
    { queues: [bulk], defaultQueue: undefined }
  ])("rejects malformed declaration safely when applied", (options) => {
    const bind = Producer.withSlot("email", job, options as never)
    expect(() => Effect.runSync(Producer.make("campaign.deliver").pipe(bind))).toThrow(
      expect.objectContaining({
        _tag: "InvalidProducerBinding",
        slot: "email",
        field: "queue"
      })
    )
  })

  it("snapshots only the newly applied list and its members without freezing caller configuration", () => {
    const mutableBulk = { ...bulk, name: bulk.name as string }
    const destinations: [Queue.JobQueue, ...Queue.JobQueue[]] = [mutableBulk, priority]
    const options = { queues: destinations }
    const bind = Producer.withSlot("email", job, options)
    const first = Effect.runSync(Effect.succeed(producer).pipe(bind))
    mutableBulk.name = "emails.changed"
    destinations.pop()
    const second = Effect.runSync(Effect.succeed(producer).pipe(bind))
    expect(first.slots.email.queues.map((queue) => queue.name)).toEqual([
      bulk.name,
      priority.name
    ])
    expect(second.slots.email.queues.map((queue) => queue.name)).toEqual([
      "emails.changed"
    ])
    expect(first.slots.fixed).toBe(producer.slots.fixed)
    expect(first.slots.email.job.payload).toBe(job.payload)
    expect(Object.isFrozen(first.slots.email.queues)).toBe(true)
    expect(first.slots.email.queues.every(Object.isFrozen)).toBe(true)
    expect([options, destinations, mutableBulk].some(Object.isFrozen)).toBe(false)
    destinations.push(mutableBulk)
    expect(() => Effect.runSync(Effect.succeed(producer).pipe(bind))).toThrow(
      Producer.InvalidProducerBinding
    )
    expect(first.slots.email.queues).toHaveLength(2)
  })
})
