import assert from "node:assert/strict"
import { Clock, DateTime, Effect, Layer, Logger, Result, Schema } from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Codes from "../../../src/FailureCode.js"
import type { JobEnqueue } from "../../../src/JobEnqueue.js"
import * as Lifecycle from "../../../src/JobLifecycle.js"
import type { HandlerInput } from "../../../src/JobContract.js"
import * as Group from "../../../src/JobGroup.js"
import * as Api from "../../../src/JobApi.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Producer from "../../../src/JobProducer.js"
import { JobFailures, type JobFailure } from "../../../src/JobFailure.js"
import { defaultPolicy } from "../../../src/JobPolicy.js"
import { JobStorage } from "../../../src/JobStorage.js"
import type { FinalizationRequest } from "../../../src/JobStore.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Testing from "../../../src/Testing.js"

const start = 1_725_000_000_000
const queue = Effect.runSync(Queue.make("billing"))
const other = Effect.runSync(Queue.make("billing-slow"))
const group = Effect.runSync(
  Group.make("billing-worker", {
    receipt: { name: "billing.receipt", version: 1, payload: Schema.String }
  })
)
const api = Effect.runSync(Api.make("billing").pipe(Api.addGroup(group)))
const producer = Effect.runSync(
  Producer.make("billing.issue").pipe(
    Producer.withSlot("receipt", group.definitions.receipt, { queues: [queue, other] })
  )
)
const busy = Codes.define({ busy: "busy" }).busy

const run = <A, E>(program: Effect.Effect<A, E, JobStorage | JobEnqueue>) =>
  Effect.runPromise(
    TestClock.setTime(start).pipe(
      Effect.andThen(program),
      Effect.provide(
        Layer.mergeAll(Testing.memoryLayer, TestClock.layer(), Logger.layer([]))
      )
    )
  )

// Observe the existing storage protocol so terminal assertions do not depend
// on a new testing API or a mutable view of the in-memory rows.
const install = Effect.fnUntraced(function* (
  handle: (input: HandlerInput<string>) => Effect.Effect<void, JobFailure>
) {
  const storage = yield* JobStorage
  const finalizations: FinalizationRequest[] = []
  const worker = yield* Worker.make(api, { queues: [{ queue }, { queue: other }] }).pipe(
    Effect.provide(
      Group.handlers(group, (handlers) => handlers.handle("receipt", handle))
    ),
    Effect.provideService(JobStorage, {
      ...storage,
      store: {
        ...storage.store,
        finalize: (request) =>
          Effect.sync(() => {
            finalizations.push(request)
          }).pipe(Effect.andThen(storage.store.finalize(request)))
      }
    })
  )
  const drain = (destination: Queue.JobQueue = queue) =>
    Worker.drain(destination, { maxJobs: 10 }).pipe(
      Effect.provideService(Worker.JobWorker, worker)
    )
  return { drain, finalizations, store: storage.store }
})

it("routes one queue-independent contract through two explicitly configured queues", async () => {
  await run(
    Effect.gen(function* () {
      const seen: HandlerInput<string>[] = []
      const { drain, finalizations, store } = yield* install((input) =>
        Effect.sync(() => {
          seen.push(input)
        })
      )
      const first = yield* producer.enqueueStandalone({
        queue: queue.name,
        slot: "receipt",
        operationId: "fast",
        payload: "first",
        availableAt: DateTime.makeUnsafe(start + 1_000)
      })
      const second = yield* producer.enqueueStandalone({
        queue: other.name,
        slot: "receipt",
        operationId: "slow",
        payload: "second"
      })
      assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 0, recovered: 0 })
      assert.equal(seen.length, 0)
      assert.deepEqual(yield* drain(other), { _tag: "Idle", claimed: 1, recovered: 0 })
      assert.deepEqual(
        seen.map((input) => input.payload),
        ["second"]
      )
      yield* TestClock.adjust(999)
      assert.equal((yield* drain()).claimed, 0)
      assert.equal(seen.length, 1)
      yield* TestClock.adjust(1)
      assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 1, recovered: 0 })
      assert.deepEqual(
        seen.map((input) => input.context.catalog.queue),
        [other.name, queue.name]
      )
      assert.deepEqual(
        seen.map((input) => input.context.jobId),
        [second.jobId, first.jobId]
      )
      assert.deepEqual(
        seen.map((input) => input.payload),
        ["second", "first"]
      )
      assert.equal(finalizations.length, 2)
      const now = yield* Clock.currentTimeMillis
      for (const request of finalizations) {
        assert.equal(request.before.finalizedAttempts, 0)
        assert.equal(request.finalization._tag, "Complete")
        const completed = Result.getOrThrow(
          Lifecycle.finalize(request.before, request.ownership, request.finalization, now)
        )
        assert.equal(completed.state, "Completed")
        assert.equal((yield* store.reconcileFinalization(request))._tag, "Applied")
      }
    })
  )
})

it("limits finalized retries to three attempts using the fixed persisted delay", async () => {
  await run(
    Effect.gen(function* () {
      const attempts: number[] = []
      const { drain, finalizations, store } = yield* install((input) =>
        Effect.sync(() => {
          attempts.push(input.context.nextFinalizationNumber)
        }).pipe(Effect.andThen(Effect.fail(JobFailures.Retry({ code: busy }))))
      )
      yield* producer.enqueueStandalone({
        queue: queue.name,
        slot: "receipt",
        operationId: "retry",
        payload: "retry"
      })
      for (let attempt = 1; attempt <= 3; attempt++) {
        assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 1, recovered: 0 })
        assert.equal(attempts.length, attempt)
        const request = finalizations[attempt - 1]!
        assert.equal(request.before.finalizedAttempts, attempt - 1)
        assert.equal(request.before.stalledCount, 0)
        assert.deepEqual(request.finalization, { _tag: "Retry", code: busy })
        const now = yield* Clock.currentTimeMillis
        const expected = Result.getOrThrow(
          Lifecycle.finalize(request.before, request.ownership, request.finalization, now)
        )
        assert.equal(expected.state, attempt === 3 ? "Dead" : "RetryScheduled")
        assert.equal(expected.finalizedAttempts, attempt)
        assert.equal(expected.stalledCount, 0)
        assert.equal((yield* store.reconcileFinalization(request))._tag, "Applied")
        yield* TestClock.adjust(attempt === 3 ? 5_000 : 4_999)
        assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 0, recovered: 0 })
        assert.equal(attempts.length, attempt)
        yield* TestClock.adjust(1)
      }
      assert.deepEqual(attempts, [1, 2, 3])
      assert.equal(finalizations.length, 3)
    })
  )
})

it("recovers an unconfirmed attempt at lease expiry without consuming its attempt number", async () => {
  await run(
    Effect.gen(function* () {
      const attempts: number[] = []
      const { drain, finalizations, store } = yield* install((input) => {
        attempts.push(input.context.nextFinalizationNumber)
        return attempts.length === 1
          ? Effect.fail(JobFailures.OutcomeUnknown())
          : Effect.void
      })
      yield* producer.enqueueStandalone({
        queue: queue.name,
        slot: "receipt",
        operationId: "recover",
        payload: "recover"
      })
      assert.equal((yield* drain()).claimed, 1)
      assert.deepEqual(attempts, [1])
      assert.equal(finalizations.length, 0)
      yield* TestClock.adjust(defaultPolicy.leaseDurationMillis - 1)
      assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 0, recovered: 0 })
      assert.deepEqual(attempts, [1])
      yield* TestClock.adjust(1)
      assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 1, recovered: 1 })
      assert.deepEqual(attempts, [1, 1])
      assert.equal(finalizations.length, 1)
      const request = finalizations[0]!
      assert.equal(request.before.finalizedAttempts, 0)
      assert.equal(request.before.stalledCount, 1)
      assert.equal(request.finalization._tag, "Complete")
      assert.equal((yield* store.reconcileFinalization(request))._tag, "Applied")
    })
  )
})

it("isolates separate builds and retains the first job for matching duplicates", async () => {
  const input = {
    queue: queue.name,
    slot: "receipt",
    operationId: "isolation",
    payload: "first"
  } as const
  await run(
    Effect.gen(function* () {
      const original = yield* producer.enqueueStandalone({
        ...input,
        availableAt: DateTime.makeUnsafe(start + 1_000)
      })
      const duplicate = yield* producer.enqueueStandalone({ ...input, queue: other.name })
      assert.deepEqual(duplicate, { _tag: "AlreadyPresent", jobId: original.jobId })
      assert.equal(
        (yield* Effect.flip(
          producer.enqueueStandalone({ ...input, payload: "conflict" })
        ))._tag,
        "JobIntegrityConflict"
      )
      const { drain } = yield* install(() =>
        Effect.die("duplicate must not move or reschedule the job")
      )
      assert.equal((yield* drain()).claimed, 0)
      assert.equal((yield* drain(other)).claimed, 0)
    })
  )
  await run(
    Effect.gen(function* () {
      const seen: string[] = []
      const { drain } = yield* install((input) =>
        Effect.sync(() => {
          seen.push(input.payload)
        })
      )
      yield* TestClock.adjust(1_000)
      assert.equal((yield* drain()).claimed, 0)
      assert.deepEqual(seen, [])
      const inserted = yield* producer.enqueueStandalone({ ...input, payload: "fresh" })
      assert.equal(inserted._tag, "Inserted")
      assert.equal((yield* drain()).claimed, 1)
      assert.deepEqual(seen, ["fresh"])
    })
  )
})
