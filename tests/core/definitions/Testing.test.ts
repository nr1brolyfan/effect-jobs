import { DateTime, Duration, Effect, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Retry from "../../../src/JobRetryPolicy.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Testing from "../../../src/Testing.js"

const issueInvoice = Effect.gen(function* () {
  const payload = Schema.Struct({ createdAt: Schema.DateTimeUtcFromString })
  const invoice = yield* Job.make({ name: "billing.invoice", payload })
  const laterVersion = yield* Job.make({ name: "billing.invoice", version: 2, payload })
  const queue = yield* Queue.make("billing")
  const producer = yield* Producer.make("billing.issue").pipe(
    Producer.withSlot("invoice", invoice, { queue }),
    Producer.withSlot("invoice-v2", laterVersion, { queue })
  )
  return { invoice, producer }
})

const earliest = DateTime.makeUnsafe(1_725_000_000_000)
const input = {
  slot: "invoice",
  operationId: "order-1",
  payload: { createdAt: earliest },
  availableAt: earliest
} as const

it("records both production entrypoints with typed payload and exact job version", async () => {
  const program = Effect.gen(function* () {
    const { invoice, producer } = yield* issueInvoice
    const first = yield* producer.enqueue(input).pipe(Testing.withJoinedEnqueue)
    const second = yield* producer.enqueueStandalone(input)
    yield* producer.enqueueStandalone({ ...input, slot: "invoice-v2" })
    const all = yield* Testing.enqueued
    expect(all.map((item) => item.catalog.version)).toEqual([1, 1, 2])
    expect(all[0]).not.toHaveProperty("encoded")
    const recorded = yield* Testing.enqueuedOf(invoice)
    expect(recorded.map((item) => item.jobId)).toEqual([first.jobId, second.jobId])
    expect(first.jobId).not.toBe(second.jobId)
    expect(recorded.map((item) => item.mode)).toEqual(["joined", "standalone"])
    expect(recorded[0]?.producer).toEqual({
      operation: "billing.issue",
      operationId: "order-1",
      slot: "invoice"
    })
    expect(recorded[0]?.catalog.queue).toBe("billing")
    expect(recorded[0]?.availableAt).toBe(DateTime.toEpochMillis(earliest))
    expect(
      recorded.map((item) => DateTime.toEpochMillis(item.payload.createdAt))
    ).toEqual([earliest, earliest].map(DateTime.toEpochMillis))
  }).pipe(Effect.provide(Testing.layer))
  await Effect.runPromise(program)
  expect(
    await Effect.runPromise(Testing.enqueued.pipe(Effect.provide(Testing.layer)))
  ).toEqual([])
})

it("rejects unsupported test scopes and records nothing after failed preparation", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { producer } = yield* issueInvoice
      const missing = yield* producer.enqueue(input).pipe(Effect.result)
      const active = yield* producer
        .enqueueStandalone(input)
        .pipe(Testing.withJoinedEnqueue, Effect.result)
      const invalid = yield* producer
        .enqueueStandalone({ ...input, operationId: "" })
        .pipe(Effect.result)
      expect(missing).toMatchObject({ failure: { reason: "transaction-required" } })
      expect(active).toMatchObject({ failure: { reason: "active-transaction" } })
      expect(invalid).toMatchObject({ failure: { _tag: "InvalidOperationId" } })
      expect(yield* Testing.enqueued).toEqual([])
    }).pipe(Effect.provide(Testing.layer))
  )
})

it("snapshots only declared policy fields from both slot policy and enqueue override", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { invoice } = yield* issueInvoice
      const queue = yield* Queue.make("billing")
      const backoff = yield* Policy.make({
        retry: Retry.exponential(Duration.seconds(2)),
        deadRetention: Duration.days(7)
      })
      const withExtras = (policy: Policy.JobPolicy) => ({
        ...policy,
        fixtureOnly: { value: "private" },
        retrySchedule: { ...policy.retrySchedule, fixtureOnly: { value: "private" } },
        deadRetention: { ...policy.deadRetention, fixtureOnly: { value: "private" } }
      })
      const slot = withExtras(Policy.defaultPolicy)
      const override = withExtras(backoff)
      const producer = yield* Producer.make("billing.issue").pipe(
        Producer.withSlot("invoice", invoice, { queue, policy: slot })
      )
      yield* producer.enqueueStandalone(input)
      yield* producer.enqueueStandalone({
        ...input,
        operationId: "order-2",
        policy: override
      })

      const metadata = yield* Testing.enqueued
      const decoded = yield* Testing.enqueuedOf(invoice)
      for (const policy of [slot, override]) {
        policy.fixtureOnly.value = "mutated"
        policy.retrySchedule.fixtureOnly.value = "mutated"
        policy.deadRetention.fixtureOnly.value = "mutated"
      }
      const reread = yield* Testing.enqueued
      const decodedAgain = yield* Testing.enqueuedOf(invoice)
      for (const records of [metadata, decoded, reread, decodedAgain]) {
        expect(records.map((item) => item.policy)).toEqual([
          Policy.defaultPolicy,
          backoff
        ])
        for (const item of records) {
          expect(Object.isFrozen(item.policy)).toBe(true)
          expect(Object.isFrozen(item.policy.retrySchedule)).toBe(true)
          expect(Object.isFrozen(item.policy.completedRetention)).toBe(true)
          expect(Object.isFrozen(item.policy.deadRetention)).toBe(true)
        }
      }
    }).pipe(Effect.provide(Testing.layer))
  )
})
