import assert from "node:assert/strict"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Logger,
  Random,
  Schema,
  Scope
} from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import { JobRegistry, layer as registryLayer } from "../../../src/JobRegistry.js"
import * as Worker from "../../../src/JobWorker.js"
import { layerForPlan } from "../../../src/PollingJobWorker.js"
import { harness, policy } from "./Harness.js"
import { JobOwnershipLost } from "../../../src/JobStore.js"
import type { JobStoreService } from "../../../src/JobStore.js"

const queue = Queue.make("polling")
const job = Job.make({
  queue,
  kind: "neutral",
  version: 1,
  payload: Schema.Struct({ value: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
const consumer = Effect.runSync(
  Consumer.make(queue, {
    localConcurrency: 2,
    claimLimitPerRun: 2,
    recoveryLimitPerRun: 1
  })
)
const plan = Effect.runSync(Consumer.plan(consumer))
const random = (value: number) =>
  Effect.provideService(Random.Random, {
    nextDoubleUnsafe: () => value,
    nextIntUnsafe: () => Math.floor(value * 2 ** 32)
  })
const run = <A, E>(program: Effect.Effect<A, E, JobRegistry | Scope.Scope>, value = 0) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([]))),
      random(value),
      Effect.scoped
    )
  )
const make = (store: JobStoreService<unknown>) =>
  Effect.gen(function* () {
    yield* Layer.build(job.handlerLayer(() => Effect.void, Codec.decodeJobPayload))
    return yield* Worker.make(store, {
      catalog: [job],
      operationResponseBudgetMillis: 100
    })
  })
const start = (worker: Worker.JobWorkerService) =>
  Layer.build(
    layerForPlan(plan).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
  )

it("performs one recovery and one empty claim, idles, and closes all polling work", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      const worker = yield* make(test.store)
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(start(worker))
      yield* Effect.yieldNow
      assert.equal(test.calls.claims.length, 1)
      assert.deepEqual(test.calls.recoveries, [1])
      yield* TestClock.adjust(799)
      assert.equal(test.calls.claims.length, 1)
      yield* TestClock.adjust(1)
      assert.equal(test.calls.claims.length, 2)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust(60_000)
      assert.equal(test.calls.claims.length, 2)
    })
  )
})

it("uses the capped infrastructure backoff sequence without job retry or repeated recovery", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      let claims = 0
      const worker = yield* make({
        ...test.store,
        claim: () =>
          Effect.sync(() => {
            claims++
          }).pipe(Effect.andThen(Effect.fail("RAW_PROVIDER_SENTINEL")))
      })
      yield* start(worker)
      yield* Effect.yieldNow
      for (const delay of [800, 1600, 3200, 6400, 12_800, 24_000, 24_000]) {
        const before = claims
        yield* TestClock.adjust(delay - 1)
        assert.equal(claims, before)
        yield* TestClock.adjust(1)
        assert.equal(claims, before + 1)
      }
      assert.equal(claims, 8)
      assert.deepEqual(test.calls.recoveries, [1])
    })
  )
})

it("resets backoff after Empty and applies upper polling jitter", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      let claims = 0
      const worker = yield* make({
        ...test.store,
        claim: (request) =>
          Effect.gen(function* () {
            claims++
            if (claims === 1 || claims === 3) {
              return yield* Effect.fail("RAW_PROVIDER_SENTINEL")
            }
            return yield* test.store.claim(request)
          })
      })
      yield* start(worker)
      yield* Effect.yieldNow
      yield* TestClock.adjust(1199)
      assert.equal(claims, 1)
      yield* TestClock.adjust(1)
      assert.equal(claims, 2)
      yield* TestClock.adjust(1200)
      assert.equal(claims, 3)
      yield* TestClock.adjust(1199)
      assert.equal(claims, 3)
      yield* TestClock.adjust(1)
      assert.equal(claims, 4)
      assert.deepEqual(test.calls.recoveries, [1, 1])
    }),
    1
  )
})

it("backs off failed recovery, then resets the following claim failure to the initial delay", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      let claims = 0
      let recoveries = 0
      const worker = yield* make({
        ...test.store,
        recoverExpired: () =>
          Effect.suspend(() => {
            recoveries++
            return recoveries <= 3 ? Effect.fail("RAW_RECOVERY") : Effect.succeed(0)
          }),
        claim: () =>
          Effect.sync(() => {
            claims++
          }).pipe(Effect.andThen(Effect.fail("RAW_CLAIM")))
      })
      yield* start(worker)
      yield* Effect.yieldNow
      assert.equal(claims, 0)
      for (const delay of [800, 1600, 3200]) {
        yield* TestClock.adjust(delay)
      }
      assert.equal(recoveries, 4)
      assert.equal(claims, 1)
      yield* TestClock.adjust(799)
      assert.equal(claims, 1)
      yield* TestClock.adjust(1)
      assert.equal(claims, 2)
      assert.equal(recoveries, 4)
    })
  )
})

it("validates every plan queue before spawning loops and rejects invalid polling configuration", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      const worker = yield* make(test.store)
      const missing = yield* Consumer.make(Queue.make("missing"), {
        localConcurrency: 1,
        claimLimitPerRun: 1,
        recoveryLimitPerRun: 1
      })
      const mixed = yield* Consumer.plan(consumer, missing)
      const failed = yield* Layer.build(
        layerForPlan(mixed).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
      ).pipe(Effect.result)
      assert.equal(failed._tag, "Failure")
      assert.equal(test.calls.claims.length, 0)
      for (const idlePollMillis of [0, -1, 0.5, Infinity, NaN]) {
        const result = yield* Layer.build(
          layerForPlan(plan, { idlePollMillis }).pipe(
            Layer.provide(Layer.succeed(Worker.JobWorker, worker))
          )
        ).pipe(Effect.result)
        assert.equal(result._tag, "Failure")
      }
    })
  )
})

it("runs parallel plans on independent runtime capabilities without a global catalog", async () => {
  await run(
    Effect.gen(function* () {
      const first = harness()
      const second = harness()
      const firstWorker = yield* make(first.store)
      const secondWorker = yield* Worker.make(second.store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      })
      yield* start(firstWorker)
      yield* start(secondWorker)
      yield* Effect.yieldNow
      assert.equal(first.calls.claims.length, 1)
      assert.equal(second.calls.claims.length, 1)
      assert.notEqual(
        first.calls.claims[0]!.leaseToken,
        second.calls.claims[0]!.leaseToken
      )
      yield* TestClock.adjust(800)
      assert.equal(first.calls.claims.length, 2)
      assert.equal(second.calls.claims.length, 2)
    })
  )
})

it("captures provider requirements once at worker construction, not as ambient polling dependencies", async () => {
  class Connection extends Context.Service<Connection, { readonly marker: string }>()(
    "tests/worker/connection"
  ) {}
  await run(
    Effect.gen(function* () {
      const test = harness()
      yield* Layer.build(job.handlerLayer(() => Effect.void, Codec.decodeJobPayload))
      const store: JobStoreService<JobOwnershipLost, Connection> = {
        ...test.store,
        claim: (request) =>
          Effect.gen(function* () {
            const connection = yield* Connection
            assert.equal(connection.marker, "borrowed")
            return yield* test.store.claim(request)
          })
      }
      const worker = yield* Worker.make(store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      }).pipe(Effect.provideService(Connection, { marker: "borrowed" }))
      yield* start(worker)
      yield* Effect.yieldNow
      assert.equal(test.calls.claims.length, 1)
    })
  )
})

it("closes active executions with the polling scope and never releases after execution began", async () => {
  await run(
    Effect.gen(function* () {
      const encoded = yield* Codec.encodeJobPayload(job.payload, { value: "value" })
      const test = harness(
        Array.from({ length: 4 }, (_, index) => ({
          catalog: job.catalog,
          producer: { operation: "test.poll", operationId: String(index), slot: "run" },
          policy,
          encoded
        }))
      )
      const reached = yield* Deferred.make<void>()
      let handlers = 0
      let stopped = 0
      yield* Layer.build(
        job.handlerLayer(
          () =>
            Effect.sync(() => {
              handlers++
            }).pipe(
              Effect.andThen(Deferred.succeed(reached, undefined)),
              Effect.andThen(Effect.never),
              Effect.ensuring(
                Effect.sync(() => {
                  stopped++
                })
              )
            ),
          Codec.decodeJobPayload
        )
      )
      const worker = yield* Worker.make(test.store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      })
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(start(worker))
      yield* Deferred.await(reached)
      for (let index = 0; index < 10; index++) {
        yield* Effect.yieldNow
      }
      assert.equal(handlers, 2)
      assert.equal(test.calls.claims.length, 2)
      yield* Scope.close(scope, Exit.void)
      assert.equal(stopped, 2)
      assert.equal(test.calls.releases, 0)
      assert.equal(test.calls.finalizations.length, 0)
      assert.equal(test.rows.filter((row) => row.snapshot.state === "Active").length, 2)
      yield* TestClock.adjust(30_000)
      assert.equal(test.calls.claims.length, 2)
    })
  )
})

it("recovers between finite backlog drains and construction/imports are cold", async () => {
  await run(
    Effect.gen(function* () {
      const encoded = yield* Codec.encodeJobPayload(job.payload, { value: "value" })
      const test = harness(
        Array.from({ length: 6 }, (_, index) => ({
          catalog: job.catalog,
          producer: { operation: "test.poll", operationId: String(index), slot: "run" },
          policy,
          encoded
        }))
      )
      const worker = yield* make(test.store)
      assert.equal(test.calls.claims.length, 0)
      assert.equal(test.calls.recoveries.length, 0)
      yield* start(worker)
      for (let index = 0; index < 50; index++) {
        yield* Effect.yieldNow
      }
      assert.ok(test.rows.every((row) => row.snapshot.state === "Completed"))
      assert.equal(test.calls.claims.length, 7)
      assert.deepEqual(test.calls.recoveries, [1, 1, 1, 1])
    })
  )
})
