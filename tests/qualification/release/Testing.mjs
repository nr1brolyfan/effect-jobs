import assert from "node:assert/strict"
import { DateTime, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Producer from "effect-jobs/JobProducer"
import * as Queue from "effect-jobs/JobQueue"
import * as JobApi from "effect-jobs/JobApi"
import * as Group from "effect-jobs/JobGroup"
import * as Worker from "effect-jobs/JobWorker"
import { TestClock } from "effect/testing"
import * as Testing from "effect-jobs/testing"

await Effect.runPromise(
  Effect.gen(function* () {
    const job = yield* Job.make({
      name: "billing.invoice",
      payload: Schema.DateTimeUtcFromString
    })
    const queue = yield* Queue.make("billing")
    const producer = yield* Producer.make("billing.issue").pipe(
      Producer.withSlot("invoice", job, { queue })
    )
    const payload = DateTime.makeUnsafe(1_725_000_000_000)
    const result = yield* producer
      .enqueue({ slot: "invoice", operationId: "order-1", payload })
      .pipe(Testing.withJoinedEnqueue)
    const captures = yield* Testing.enqueuedOf(job)
    assert.equal(captures.length, 1)
    assert.equal(captures[0].jobId, result.jobId)
    assert.equal(
      DateTime.toEpochMillis(captures[0].payload),
      DateTime.toEpochMillis(payload)
    )
  }).pipe(Effect.provide(Testing.layer))
)

await Effect.runPromise(
  Effect.gen(function* () {
    yield* TestClock.setTime(1_725_000_000_000)
    const queue = yield* Queue.make("billing")
    const job = yield* Job.make({ name: "billing.receipt", payload: Schema.String })
    const producer = yield* Producer.make("billing.capture").pipe(
      Producer.withSlot("receipt", job, { queue })
    )
    const group = yield* Group.make("installed", { receipt: job })
    const api = yield* JobApi.make("testing").pipe(JobApi.addGroup(group))
    const seen = []
    const worker = yield* Worker.make(api, { queues: [{ queue }] }).pipe(
      Effect.provide(
        Group.handlers(group, (handlers) =>
          handlers.handle("receipt", (input) =>
            Effect.sync(() => {
              seen.push(input)
            })
          )
        )
      )
    )
    const drain = Worker.drain(queue).pipe(
      Effect.provideService(Worker.JobWorker, worker)
    )
    const enqueued = yield* producer.enqueueStandalone({
      slot: "receipt",
      operationId: "order-2",
      payload: "sample",
      availableAt: DateTime.makeUnsafe(1_725_000_001_000)
    })
    assert.equal((yield* drain).claimed, 0)
    assert.deepEqual(seen, [])
    yield* TestClock.adjust("1 second")
    assert.deepEqual(yield* drain, { _tag: "Idle", claimed: 1, recovered: 0 })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].payload, "sample")
    assert.equal(seen[0].context.jobId, enqueued.jobId)
    assert.equal((yield* drain).claimed, 0)
  }).pipe(Effect.provide(Layer.merge(Testing.memoryLayer, TestClock.layer())))
)
