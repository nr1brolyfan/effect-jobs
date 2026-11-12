import assert from "node:assert/strict"
import { test } from "vitest"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import * as Definitions from "./Definitions.mjs"
import { parseOptions } from "./Support.mjs"
import * as ApiBuilder from "effect-jobs/JobApiBuilder"
import * as Worker from "effect-jobs/JobWorker"
import * as Storage from "effect-jobs/JobStorage"
import * as Policy from "effect-jobs/JobPolicy"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { JobId } from "effect-jobs/JobId"
import { EnqueueResult } from "effect-jobs/JobContract"

const options = parseOptions(["--smoke"])

test("lazy soak setup shares queue-independent contracts and preserves producer routing", async () => {
  const program = Definitions.make(options)
  assert.equal(Effect.isEffect(program), true)
  const setup = await Effect.runPromise(program)
  assert.deepEqual(
    setup.queues.map((queue) => queue.name),
    ["soak.q0", "soak.q1"]
  )
  assert.deepEqual(
    setup.definitions.map((job) => job.name),
    ["soak.kind0", "soak.kind1"]
  )
  assert.equal(Object.keys(setup.group.definitions).length, options.kindsPerQueue)
  assert.equal(setup.routes.length, 4)
  const prepared = []
  const producerService = JobEnqueue.of({
    enqueue: () => Effect.die("Unexpected joined enqueue"),
    enqueueStandalone: (prepare) =>
      Effect.map(prepare, (job) => {
        prepared.push(job)
        return EnqueueResult.Inserted({
          jobId: Schema.decodeSync(JobId)("synthetic-soak")
        })
      })
  })
  for (const operation of ["soak.load", "soak.history"]) {
    for (const [index, producer] of setup.producers[operation].entries()) {
      assert.equal(
        producer.slots.work.job.payload,
        setup.routes[index].definition.payload
      )
      await Effect.runPromise(
        producer
          .enqueueStandalone({
            operationId: String(index),
            slot: "work",
            payload: { data: "synthetic" },
            policy: setup.churnPolicy
          })
          .pipe(Effect.provideService(JobEnqueue, producerService))
      )
      const job = prepared.at(-1)
      assert.deepEqual(job.catalog, {
        queue: setup.routes[index].queue.name,
        name: setup.routes[index].definition.name,
        version: 1
      })
      assert.deepEqual(job.producer, {
        operation,
        operationId: String(index),
        slot: "work"
      })
      assert.deepEqual(job.policy, setup.churnPolicy)
    }
  }
  assert.equal(prepared.length, 8)
  assert.equal(setup.churnPolicy.completedRetention.millis, 2000)
  assert.deepEqual(Policy.defaultPolicy.completedRetention, {
    _tag: "Duration",
    millis: 90 * 24 * 60 * 60 * 1000
  })
  const fresh = await Effect.runPromise(program)
  assert.notEqual(fresh.group, setup.group)
  assert.notEqual(fresh.producers["soak.load"][0], setup.producers["soak.load"][0])
})

test("catalog-backed soak workers recover only their queue and keep bounded claims", async () => {
  const setup = await Effect.runPromise(Definitions.make(options))
  const calls = []
  const unexpected = () => Effect.die("Unexpected workload storage operation")
  const store = {
    recoverExpired: (queue, limit) =>
      Effect.sync(() => {
        calls.push({ operation: "recover", queue, limit })
        return 0
      }),
    claim: (request) =>
      Effect.sync(() => {
        calls.push({ operation: "claim", request })
        return { _tag: "Empty" }
      }),
    reconcileClaim: unexpected,
    release: unexpected,
    finalize: unexpected,
    reconcileFinalization: unexpected
  }
  const handlers = ApiBuilder.group(setup.catalog, setup.group.name, (initial) =>
    initial.handle("kind0", () => Effect.void).handle("kind1", () => Effect.void)
  )
  const runtime = ManagedRuntime.make(
    Worker.layer(setup.catalog, {
      queues: setup.queues.map((queue) => ({ queue, concurrency: options.concurrency }))
    }).pipe(
      Layer.provide(handlers),
      Layer.provide(Storage.layer({ store, operationResponseBudgetMillis: 1000 }))
    )
  )
  try {
    assert.deepEqual(calls, [])
    for (const queue of setup.queues) {
      const result = await runtime.runPromise(
        Worker.drain(queue, { maxJobs: 20, recoveryLimit: 20 })
      )
      assert.equal(result._tag, "Idle")
    }
    assert.deepEqual(
      calls.filter((call) => call.operation === "recover"),
      [
        { operation: "recover", queue: "soak.q0", limit: 20 },
        { operation: "recover", queue: "soak.q1", limit: 20 }
      ]
    )
    for (const call of calls.filter((call) => call.operation === "claim")) {
      assert.deepEqual(
        call.request.supportedCatalog,
        setup.definitions.map((job) => ({
          queue: call.request.queue,
          name: job.name,
          version: job.version
        }))
      )
    }
  } finally {
    await runtime.dispose()
  }
})
