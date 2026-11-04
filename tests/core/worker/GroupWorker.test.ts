import { Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { TestClock } from "effect/testing"
import * as Group from "../../../src/JobGroup.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import { FinalizationResult } from "../../../src/JobStore.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Storage from "../../../src/JobStorage.js"
import { harness, policy } from "./Harness.js"

const queue = Queue.make("billing")
const definition = {
  kind: "billing.receipt",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String })
}
const group = Group.make("billing-worker", { receipt: definition })
const seed = Effect.fnUntraced(function* (count = 1) {
  const encoded = yield* Codec.encodeJobPayload(definition.payload, { invoiceId: "one" })
  return harness(
    Array.from({ length: count }, (_, index) => ({
      catalog: { queue: queue.name, kind: definition.kind, version: 1 },
      producer: {
        operation: "billing.issue",
        operationId: `invoice-${index}`,
        slot: "receipt"
      },
      policy,
      encoded
    }))
  )
})

describe("group-backed worker construction", () => {
  it("recovers only the drained queue, preserving another queue's expired ownership", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const other = Queue.make("billing-other")
        const encoded = yield* Codec.encodeJobPayload(definition.payload, {
          invoiceId: "one"
        })
        const test = harness(
          [queue, other].map((destination) => ({
            catalog: { queue: destination.name, kind: definition.kind, version: 1 },
            producer: {
              operation: "billing.issue",
              operationId: destination.name,
              slot: "receipt"
            },
            policy,
            encoded
          }))
        )
        for (const destination of [queue, other]) {
          const claim = yield* test.store.claim({
            queue: destination.name,
            supportedCatalog: [
              { queue: destination.name, kind: definition.kind, version: 1 }
            ],
            leaseToken: globalThis.crypto.randomUUID()
          })
          expect(claim._tag).toBe("Claimed")
        }
        const untouched = test.rows[1]!.snapshot
        yield* TestClock.adjust(policy.leaseDurationMillis)
        const worker = yield* Worker.make(group, {
          queues: [{ queue }, { queue: other }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        const result = yield* worker.drain(queue)
        expect(result).toMatchObject({ _tag: "Idle", recovered: 1, claimed: 1 })
        expect(test.rows[0]!.snapshot.state).toBe("Completed")
        expect(test.rows[1]!.snapshot).toEqual(untouched)
        yield* worker.drain(other)
        expect(test.rows[1]!.snapshot.state).toBe("Completed")
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({ receipt: () => Effect.void }),
            TestClock.layer(),
            Logger.layer([])
          )
        )
      )
    )
  })
  it("routes one queue-independent contract through two explicitly configured queues", async () => {
    const other = Queue.make("billing-slow")
    const seen: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(definition.payload, {
          invoiceId: "one"
        })
        const test = harness(
          [queue, other].map((destination) => ({
            catalog: { queue: destination.name, kind: definition.kind, version: 1 },
            producer: {
              operation: "billing.issue",
              operationId: destination.name,
              slot: "receipt"
            },
            policy,
            encoded
          }))
        )
        const worker = yield* Worker.make(group, {
          queues: [{ queue }, { queue: other }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        yield* worker.drain(other)
        yield* worker.drain(queue)
        expect(test.calls.claims[0]!.queue).toBe(other.name)
        expect(test.rows.every((row) => row.snapshot.state === "Completed")).toBe(true)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({
              receipt: (input) =>
                Effect.sync(() => {
                  seen.push(input.context.catalog.queue)
                })
            }),
            Logger.layer([])
          )
        )
      )
    )
    expect(seen).toEqual([other.name, queue.name])
  })
  it("constructs without store activity and executes with no public registry", async () => {
    let calls = 0
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const test = yield* seed(2)
        const worker = yield* Worker.make(group, {
          queues: [{ queue, concurrency: 1 }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        expect(test.calls.claims).toHaveLength(0)
        expect(test.calls.recoveries).toHaveLength(0)
        const drained = yield* worker.drain(queue)
        expect(test.rows.map((row) => row.snapshot.state)).toEqual([
          "Completed",
          "Completed"
        ])
        return drained
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({
              receipt: (input) =>
                Effect.sync(() => {
                  expect(input.payload.invoiceId).toBe("one")
                  calls++
                })
            }),
            Logger.layer([])
          )
        )
      )
    )
    expect(calls).toBe(2)
    expect(result).toEqual({ _tag: "Idle", claimed: 2, recovered: 0 })
  })

  it("fixes shared concurrency before simultaneous drains start", async () => {
    let active = 0
    let maximum = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const test = yield* seed(2)
        const entered = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const handlers = group.toLayer({
          receipt: () =>
            Effect.gen(function* () {
              active++
              maximum = Math.max(maximum, active)
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(gate)
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active--
                })
              )
            )
        })
        const worker = yield* Worker.make(group, {
          queues: [{ queue, concurrency: 1 }]
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 }),
              handlers
            )
          )
        )
        const first = yield* worker.drain(queue, { maxJobs: 1 }).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const second = yield* worker.drain(queue, { maxJobs: 1 }).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(test.calls.claims).toHaveLength(1)
        expect(active).toBe(1)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(test.rows.every((row) => row.snapshot.state === "Completed")).toBe(true)
      }).pipe(Effect.provide(Logger.layer([])))
    )
    expect(maximum).toBe(1)
    expect(active).toBe(0)
  })

  it.each([0, 65, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects concurrency %s before storage activity",
    async (concurrency) => {
      const test = harness()
      const result = await Effect.runPromise(
        Worker.make(group, { queues: [{ queue, concurrency }] }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 }),
              group.toLayer({ receipt: () => Effect.void })
            )
          ),
          Effect.result
        )
      )
      expect(result).toMatchObject({ _tag: "Failure", failure: { field: "queues" } })
      expect(test.calls.claims).toHaveLength(0)
      expect(test.calls.recoveries).toHaveLength(0)
    }
  )

  it("rejects repeated or empty queue configuration", async () => {
    for (const queues of [[], [{ queue }, { queue }]]) {
      const result = await Effect.runPromise(
        Worker.make(group, { queues }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Storage.layer({
                store: harness().store,
                operationResponseBudgetMillis: 100
              }),
              group.toLayer({ receipt: () => Effect.void })
            )
          ),
          Effect.result
        )
      )
      expect(result).toMatchObject({ _tag: "Failure", failure: { field: "queues" } })
    }
  })

  it("does not accept per-drain concurrency, invalid limits or unconfigured queues", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const test = yield* seed()
        const worker = yield* Worker.make(group, { queues: [{ queue }] }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        for (const limits of [
          { maxJobs: 0 },
          { maxJobs: 10001 },
          { maxJobs: 1.5 },
          { recoveryLimit: 0 },
          { recoveryLimit: 10001 },
          { recoveryLimit: 1.5 },
          { maxJobs: 1, extra: true },
          { maxJobs: 1, concurrency: 8 }
        ]) {
          const result = yield* worker.drain(queue, limits).pipe(Effect.result)
          expect(result).toMatchObject({ _tag: "Failure", failure: { field: "drain" } })
        }
        const foreign = yield* worker.drain(Queue.make("other")).pipe(Effect.result)
        expect(foreign).toMatchObject({ _tag: "Failure", failure: { field: "queues" } })
        expect(test.calls.claims).toHaveLength(0)
        expect(test.calls.recoveries).toHaveLength(0)
      }).pipe(Effect.provide(group.toLayer({ receipt: () => Effect.void })))
    )
  })

  it("accepts upper construction and drain bounds without consumer/plan configuration", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const test = harness()
        const worker = yield* Worker.make(group, {
          queues: [{ queue, concurrency: 64 }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        expect(test.calls.claims).toHaveLength(0)
        expect(test.calls.recoveries).toHaveLength(0)
        const result = yield* worker.drain(queue, {
          maxJobs: 10000,
          recoveryLimit: 10000
        })
        expect(result).toEqual({ _tag: "Idle", claimed: 0, recovered: 0 })
        expect(test.calls.claims).toHaveLength(1)
        expect(test.calls.recoveries).toEqual([500])
      }).pipe(Effect.provide(group.toLayer({ receipt: () => Effect.void })))
    )
  })

  it("reconciles a lost finalization response without invoking the handler again", async () => {
    let executions = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const test = yield* seed()
        const worker = yield* Worker.make(group, { queues: [{ queue }] }).pipe(
          Effect.provide(
            Storage.layer({
              operationResponseBudgetMillis: 100,
              store: {
                ...test.store,
                finalize: (request) =>
                  test.store
                    .finalize(request)
                    .pipe(Effect.as(FinalizationResult.Unknown()))
              }
            })
          )
        )
        yield* worker.drain(queue)
        expect(test.calls.finalizations).toHaveLength(1)
        expect(test.calls.finalizationReconciliations).toHaveLength(1)
        expect(test.rows[0]!.snapshot.state).toBe("Completed")
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({
              receipt: () =>
                Effect.sync(() => {
                  executions++
                })
            }),
            Logger.layer([])
          )
        )
      )
    )
    expect(executions).toBe(1)
  })
})
