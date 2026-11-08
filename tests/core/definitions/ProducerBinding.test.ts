import { Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Producer from "../../../src/JobProducer.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Group from "../../../src/JobGroup.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Storage from "../../../src/JobStorage.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Payload from "../../../src/JobPayload.js"
import { EnqueueResult } from "../../../src/JobContract.js"
import type { PreparedJob } from "../../../src/JobContract.js"
import { JobEnqueue, JobBackendError } from "../../../src/JobEnqueue.js"
import type { JobEnqueueService } from "../../../src/JobEnqueue.js"
import { JobId } from "../../../src/JobId.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"
import type { JobsTransaction } from "../../../src/JobTransaction.js"
import {
  Document,
  DocumentEncryption,
  keys,
  keysLayer
} from "../codec/EncryptedFixture.js"
import { harness } from "../worker/Harness.js"

const queue = Queue.make("billing")
const job = {
  kind: "billing.receipt",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String })
}
const assigned = Schema.decodeSync(JobId)("assigned-by-storage")
const receipt = Producer.make("billing.issue").pipe(
  Producer.withSlot("receipt", job, { queue })
)

const capture = (prepared: PreparedJob[]): JobEnqueueService => ({
  enqueue: (prepare) =>
    Effect.flatMap(prepare, (value) =>
      Effect.sync(() => {
        prepared.push(value)
        return EnqueueResult.Inserted({ jobId: assigned })
      })
    ),
  enqueueStandalone: (prepare) =>
    Effect.flatMap(prepare, (value) =>
      Effect.sync(() => {
        prepared.push(value)
        return EnqueueResult.Inserted({ jobId: assigned })
      })
    )
})

const methods = ["enqueue", "enqueueStandalone", "enqueueInTransaction"] as const
const produce = (
  method: (typeof methods)[number],
  input: Producer.Input<typeof receipt.slots, "receipt">,
  prepared: PreparedJob[]
) =>
  method === "enqueueInTransaction"
    ? withJoinedTransaction(
        (value) =>
          Effect.sync(() => {
            prepared.push(value)
            return EnqueueResult.Inserted({ jobId: assigned })
          }),
        (tx) => receipt.enqueueInTransaction(tx, input)
      )
    : receipt[method](input).pipe(Effect.provideService(JobEnqueue, capture(prepared)))

describe("contract-first producer binding", () => {
  it.each(methods)(
    "%s resolves independent overrides without changing defaults",
    async (method) => {
      const prepared: PreparedJob[] = []
      const priority = Queue.make("billing-priority")
      const policy = { ...Policy.defaultPolicy, maxFinalizedAttempts: 7 }
      const input = {
        slot: "receipt",
        operationId: "same",
        payload: { invoiceId: "one" }
      } as const
      for (const overrides of [
        {},
        { queue: priority },
        { policy },
        { queue: priority, policy },
        {}
      ]) {
        await Effect.runPromise(produce(method, { ...input, ...overrides }, prepared))
      }
      expect(prepared.map((value) => value.catalog.queue)).toEqual([
        queue.name,
        priority.name,
        queue.name,
        priority.name,
        queue.name
      ])
      expect(prepared.map((value) => value.policy.maxFinalizedAttempts)).toEqual([
        Policy.defaultPolicy.maxFinalizedAttempts,
        Policy.defaultPolicy.maxFinalizedAttempts,
        7,
        7,
        Policy.defaultPolicy.maxFinalizedAttempts
      ])
      expect(prepared.every((value) => value.producer.operationId === "same")).toBe(true)
      expect(receipt.slots.receipt.queue).toEqual(queue)
    }
  )

  it.each(methods)(
    "%s rejects malformed overrides through the typed channel before insertion",
    async (method) => {
      for (const overrides of [
        { queue: { ...queue, name: "Invalid/queue" as typeof queue.name } },
        { queue: null as unknown as Queue.JobQueue },
        { policy: { ...Policy.defaultPolicy, maxFinalizedAttempts: 0 } },
        {
          policy: {
            ...Policy.defaultPolicy,
            attemptTimeoutMillis: Policy.defaultPolicy.leaseDurationMillis
          }
        },
        { policy: null as unknown as Policy.JobPolicy }
      ]) {
        const prepared: PreparedJob[] = []
        const result = await Effect.runPromise(
          produce(
            method,
            {
              slot: "receipt",
              operationId: "same",
              payload: { invoiceId: "one" },
              ...overrides
            },
            prepared
          ).pipe(Effect.result)
        )
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "InvalidJobInput",
            field: "queue" in overrides ? "catalog" : "policy"
          }
        })
        expect(prepared).toHaveLength(0)
      }
    }
  )

  it("binds slots to one queue-independent contract and executes through the public group worker", async () => {
    const other = Queue.make("billing-slow")
    const producer = Producer.make("billing.issue").pipe(
      Producer.withSlot("receipt", job, { queue }),
      Producer.withSlot("deferred", job, { queue: other })
    )
    const group = Group.make("billing-producer", { receipt: job })
    const prepared: PreparedJob[] = []
    const seen: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* producer.enqueue({
          slot: "receipt",
          operationId: "invoice-1",
          payload: { invoiceId: "one" }
        })
        yield* producer.enqueueStandalone({
          slot: "deferred",
          operationId: "invoice-1",
          payload: { invoiceId: "one" },
          availableAt: 1
        })
        expect(prepared.map((value) => value.catalog.queue)).toEqual([
          queue.name,
          other.name
        ])
        expect(prepared.map((value) => value.producer.slot)).toEqual([
          "receipt",
          "deferred"
        ])
        expect(prepared[0]!.encoded.semanticProjectionBytes).toEqual(
          prepared[1]!.encoded.semanticProjectionBytes
        )
        expect(prepared[0]!.policy).toEqual(Policy.defaultPolicy)
        const test = harness(prepared)
        const worker = yield* Worker.make(group, {
          queues: [{ queue }, { queue: other }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        yield* worker.drain(queue)
        yield* worker.drain(other)
        expect(test.rows.every((row) => row.snapshot.state === "Completed")).toBe(true)
      }).pipe(
        Effect.provideService(JobEnqueue, capture(prepared)),
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({
              receipt: (input) =>
                Effect.sync(() => {
                  seen.push(input.payload.invoiceId)
                })
            }),
            Logger.layer([])
          )
        )
      )
    )
    expect(seen).toEqual(["one", "one"])
    expect(Object.hasOwn(job, "queue")).toBe(false)
  })

  it.each(["", "x".repeat(257), "nul\u0000id", "\ud800"])(
    "rejects an invalid runtime operation ID through Effect",
    async (operationId) => {
      const prepared: PreparedJob[] = []
      const effect = receipt.enqueue({
        slot: "receipt",
        operationId,
        payload: { invoiceId: "one" }
      })
      const result = await Effect.runPromise(
        effect.pipe(Effect.provideService(JobEnqueue, capture(prepared)), Effect.result)
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidOperationId" }
      })
      expect(prepared).toHaveLength(0)
      expect(JSON.stringify(result)).not.toContain(
        operationId.length > 0 ? operationId : "private-payload-canary"
      )
    }
  )

  it("snapshots routing, contract and nested policy without freezing caller-owned objects", async () => {
    const configured = {
      ...Policy.defaultPolicy,
      retrySchedule: { ...Policy.defaultPolicy.retrySchedule }
    }
    const contract = { ...job }
    const destination = { ...queue }
    const producer = Producer.make("billing.snapshot").pipe(
      Producer.withSlot("receipt", contract, { queue: destination, policy: configured })
    )
    contract.kind = "changed"
    destination.name = "changed" as typeof queue.name
    configured.maxFinalizedAttempts++
    const prepared: PreparedJob[] = []
    const result = await Effect.runPromise(
      producer
        .enqueue({ slot: "receipt", operationId: "one", payload: { invoiceId: "one" } })
        .pipe(Effect.provideService(JobEnqueue, capture(prepared)))
    )
    expect(result.jobId).toBe(assigned)
    expect(prepared[0]!.catalog).toEqual({
      queue: "billing",
      kind: "billing.receipt",
      version: 1
    })
    expect(prepared[0]!.policy.maxFinalizedAttempts).toBe(
      Policy.defaultPolicy.maxFinalizedAttempts
    )
    expect(Object.isFrozen(contract)).toBe(false)
    expect(Object.isFrozen(configured)).toBe(false)
  })

  it("diagnoses unsupported Schema structures before any production effect", () => {
    const recursive = Schema.suspend((): Schema.String => Schema.String)
    expect(() =>
      Producer.make("billing.invalid").pipe(
        Producer.withSlot("receipt", { ...job, payload: recursive }, { queue })
      )
    ).toThrow(Producer.InvalidProducerBinding)
  })

  it("checks transaction presence and callback lifetime before encryption", async () => {
    let seals = 0
    const payload = Payload.encrypted({
      schema: Document,
      codec: {
        ...DocumentEncryption,
        seal: (input) =>
          Effect.suspend(() => {
            seals++
            return DocumentEncryption.seal(input)
          })
      }
    })
    const producer = Producer.make("billing.private").pipe(
      Producer.withSlot("receipt", { ...job, payload }, { queue })
    )
    const input = {
      slot: "receipt",
      operationId: "one",
      payload: { recipient: "private", total: 1n }
    } as const
    for (const overrides of [
      { queue: { ...queue, name: "Invalid/queue" as typeof queue.name } },
      { policy: { ...Policy.defaultPolicy, maxFinalizedAttempts: 0 } }
    ]) {
      const result = await Effect.runPromise(
        producer
          .enqueue({ ...input, ...overrides })
          .pipe(
            Effect.provideService(JobEnqueue, capture([])),
            Effect.provide(keysLayer(keys())),
            Effect.result
          )
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidJobInput" }
      })
      expect(seals).toBe(0)
    }
    const missing: JobEnqueueService = {
      enqueue: () =>
        Effect.fail(
          new JobBackendError({
            reason: "transaction-required",
            commitKnowledge: "NotCommitted"
          })
        ),
      enqueueStandalone: () => Effect.die("unexpected standalone")
    }
    const absent = await Effect.runPromise(
      producer
        .enqueue(input)
        .pipe(
          Effect.provideService(JobEnqueue, missing),
          Effect.provide(keysLayer(keys())),
          Effect.result
        )
    )
    expect(absent).toMatchObject({
      _tag: "Failure",
      failure: { reason: "transaction-required" }
    })
    let escaped: JobsTransaction | undefined
    await Effect.runPromise(
      withJoinedTransaction(
        () => Effect.die("must not insert"),
        (tx) =>
          Effect.sync(() => {
            escaped = tx
          })
      )
    )
    const closed = await Effect.runPromise(
      producer
        .enqueueInTransaction(escaped!, input)
        .pipe(Effect.provide(keysLayer(keys())), Effect.result)
    )
    expect(closed).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "JobsTransactionClosed" }
    })
    expect(seals).toBe(0)
  })
  it("snapshots identity, availability and caller-owned overrides before asynchronous encoding", async () => {
    const prepared: PreparedJob[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const proceed = yield* Deferred.make<void>()
        const payload = Payload.encrypted({
          schema: Document,
          codec: {
            ...DocumentEncryption,
            seal: (input) =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(proceed)),
                Effect.andThen(DocumentEncryption.seal(input))
              )
          }
        })
        const producer = Producer.make("billing.snapshot-input").pipe(
          Producer.withSlot("receipt", { ...job, payload }, { queue })
        )
        const destination = { ...Queue.make("billing-priority") }
        const configured = {
          ...Policy.defaultPolicy,
          maxFinalizedAttempts: 7,
          retrySchedule: { ...Policy.defaultPolicy.retrySchedule }
        }
        const input = {
          slot: "receipt" as const,
          operationId: "original",
          payload: { recipient: "private", total: 1n },
          availableAt: 1,
          queue: destination,
          policy: configured
        }
        const fiber = yield* producer.enqueue(input).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        input.operationId = "changed\u0000"
        input.availableAt = 2
        destination.name = "changed" as typeof destination.name
        configured.maxFinalizedAttempts = 8
        configured.retrySchedule.delayMillis = 123
        yield* Deferred.succeed(proceed, undefined)
        yield* Fiber.join(fiber)
        expect(prepared[0]!.producer).toEqual({
          operation: producer.operation,
          operationId: "original",
          slot: "receipt"
        })
        expect(prepared[0]!.availableAt).toBe(1)
        expect(prepared[0]!.catalog.queue).toBe("billing-priority")
        expect(prepared[0]!.policy.maxFinalizedAttempts).toBe(7)
        expect(prepared[0]!.policy.retrySchedule).toEqual(
          Policy.defaultPolicy.retrySchedule
        )
        expect(Object.isFrozen(prepared[0]!.policy)).toBe(true)
        expect(Object.isFrozen(prepared[0]!.policy.retrySchedule)).toBe(true)
        expect(Object.isFrozen(configured)).toBe(false)
        expect(Object.isFrozen(configured.retrySchedule)).toBe(false)
      }).pipe(
        Effect.provideService(JobEnqueue, capture(prepared)),
        Effect.provide(keysLayer(keys()))
      )
    )
  })
})
