import * as JobApi from "../../../src/JobApi.js"
import assert from "node:assert/strict"
import {
  Duration,
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
import * as Job from "../definitions/ProtocolJob.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Group from "../../../src/JobGroup.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Storage from "../../../src/JobStorage.js"
import * as Polling from "../../../src/JobPolling.js"
import { harness, policy } from "./Harness.js"
import { ClaimResult, JobOwnershipLost } from "../../../src/JobStore.js"
import type { JobStoreService } from "../../../src/JobStore.js"

const queue = Effect.runSync(Queue.make("polling"))
const job = Effect.runSync(
  Job.make({
    queue,
    name: "neutral",
    version: 1,
    payload: Schema.Struct({ value: Schema.String }),
    encodePayload: Codec.encodeJobPayload
  })
)
const group = Effect.runSync(Group.make("polling", { neutral: job }))
const handlers = Group.handlers(group, (_handlers) =>
  _handlers.handle("neutral", () => Effect.void)
)
const pollingOptions = { maxJobs: 2, recoveryLimit: 1 }
const random = (value: number) =>
  Effect.provideService(Random.Random, {
    nextDoubleUnsafe: () => value,
    nextIntUnsafe: () => Math.floor(value * 2 ** 32)
  })
const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>, value = 0) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.mergeAll(TestClock.layer(), Logger.layer([]))),
      random(value),
      Effect.scoped
    )
  )
const make = (store: JobStoreService<unknown>) =>
  Worker.make(Effect.runSync(JobApi.make(group.name).pipe(JobApi.addGroup(group))), {
    queues: [{ queue, concurrency: 2 }]
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Storage.layer({ store, operationResponseBudget: Duration.millis(100) }),
        handlers
      )
    )
  )
const start = (
  worker: Worker.JobWorkerService,
  options: Polling.Options = pollingOptions
) =>
  Layer.build(
    Polling.layer([queue], options).pipe(
      Layer.provide(Layer.succeed(Worker.JobWorker, worker))
    )
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

it("preserves capped claim backoff while retrying recovery at the default threshold", async () => {
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
      for (const [delay, recoveries] of [
        [800, 1],
        [1600, 1],
        [3200, 1],
        [6400, 1],
        [12_800, 1],
        [24_000, 2],
        [24_000, 2]
      ] as const) {
        const before = claims
        yield* TestClock.adjust(delay - 1)
        assert.equal(claims, before)
        yield* TestClock.adjust(1)
        assert.equal(claims, before + 1)
        assert.deepEqual(
          test.calls.recoveries,
          Array.from({ length: recoveries }, () => 1)
        )
      }
      assert.equal(claims, 8)
    })
  )
})

it.each(["claim", "reconciliation"] as const)(
  "recovers an expired job during sustained %s failures at the next eligible round",
  async (phase) => {
    await run(
      Effect.gen(function* () {
        const shortPolicy = {
          ...policy,
          attemptTimeoutMillis: 100,
          leaseDurationMillis: 500
        }
        const catalog = job.catalog
        const encoded = yield* Codec.encodeJobPayload(job.payload, { value: "recover" })
        const test = harness(
          ["first", "second"].map((operationId) => ({
            catalog,
            producer: { operation: "polling", operationId, slot: "neutral" },
            policy: shortPolicy,
            encoded
          }))
        )
        const request = {
          queue: queue.name,
          supportedCatalog: [catalog]
        }
        for (let i = 0; i < 2; i++) {
          const claimed = yield* test.store.claim({
            ...request,
            leaseToken: globalThis.crypto.randomUUID()
          })
          assert.equal(claimed._tag, "Claimed")
        }
        let claims = 0
        let reconciliations = 0
        const worker = yield* make({
          ...test.store,
          claim: () =>
            Effect.suspend(() => {
              claims++
              return phase === "claim"
                ? Effect.fail("RAW_CLAIM")
                : Effect.succeed(ClaimResult.Unknown())
            }),
          reconcileClaim: () =>
            Effect.suspend(() => {
              reconciliations++
              return Effect.fail("RAW_RECONCILIATION")
            })
        })
        yield* start(worker, { ...pollingOptions, recoveryRetryIntervalMillis: 801 })
        yield* Effect.yieldNow
        assert.deepEqual(test.calls.recoveries, [1])
        yield* TestClock.adjust(800)
        assert.equal(claims, 2)
        assert.deepEqual(test.calls.recoveries, [1])
        yield* TestClock.adjust(1599)
        assert.equal(claims, 2)
        assert.deepEqual(
          test.rows.map(({ snapshot }) => snapshot.state),
          ["Active", "Active"]
        )
        yield* TestClock.adjust(1)
        assert.equal(claims, 3)
        assert.equal(reconciliations, phase === "reconciliation" ? 3 : 0)
        assert.deepEqual(test.calls.recoveries, [1, 1])
        assert.deepEqual(
          test.rows.map(({ snapshot }) => snapshot.state),
          ["Pending", "Active"]
        )
        assert.equal(test.calls.releases, 0)
        assert.equal(test.calls.finalizations.length, 0)
      })
    )
  }
)

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
      const mixed = [queue, Effect.runSync(Queue.make("missing"))]
      const failed = yield* Layer.build(
        Polling.layer(mixed, pollingOptions).pipe(
          Layer.provide(Layer.succeed(Worker.JobWorker, worker))
        )
      ).pipe(Effect.result)
      assert.equal(failed._tag, "Failure")
      assert.equal(test.calls.claims.length, 0)
      for (const queues of [[], [queue, queue]]) {
        const result = yield* Layer.build(
          Polling.layer(queues).pipe(
            Layer.provide(Layer.succeed(Worker.JobWorker, worker))
          )
        ).pipe(Effect.result)
        assert.equal(result._tag, "Failure")
      }
      for (const options of [
        { maxJobs: 0 },
        { recoveryLimit: 10_001 },
        { ...pollingOptions, concurrency: 8 }
      ]) {
        const result = yield* Layer.build(
          Polling.layer([queue], options).pipe(
            Layer.provide(Layer.succeed(Worker.JobWorker, worker))
          )
        ).pipe(Effect.result)
        assert.equal(result._tag, "Failure")
      }
      for (const recoveryRetryIntervalMillis of [
        0,
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER
      ]) {
        const result = yield* start(worker, { recoveryRetryIntervalMillis }).pipe(
          Effect.result
        )
        assert.equal(result._tag, "Failure")
      }
      for (const idlePollMillis of [0, -1, 0.5, Infinity]) {
        const result = yield* Layer.build(
          Polling.layer([queue], {
            ...pollingOptions,
            idlePoll: Duration.millis(idlePollMillis)
          }).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
        ).pipe(Effect.result)
        assert.equal(result._tag, "Failure")
      }
      for (const shutdownGraceMillis of [-1, 0.5, 300_001, Infinity]) {
        const result = yield* Layer.build(
          Polling.layer([queue], {
            ...pollingOptions,
            shutdownGrace: Duration.millis(shutdownGraceMillis)
          }).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
        ).pipe(Effect.result)
        assert.equal(result._tag, "Failure")
      }
      assert.equal(test.calls.claims.length, 0)
      assert.equal(test.calls.recoveries.length, 0)
    })
  )
})

it("runs parallel plans on independent runtime capabilities without a global catalog", async () => {
  await run(
    Effect.gen(function* () {
      const first = harness()
      const second = harness()
      const firstWorker = yield* make(first.store)
      const secondWorker = yield* make(second.store)
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
      const store: JobStoreService<JobOwnershipLost, Connection> = {
        ...test.store,
        claim: (request) =>
          Effect.gen(function* () {
            const connection = yield* Connection
            assert.equal(connection.marker, "borrowed")
            return yield* test.store.claim(request)
          })
      }
      const worker = yield* Worker.make(
        Effect.runSync(JobApi.make(group.name).pipe(JobApi.addGroup(group))),
        {
          queues: [{ queue, concurrency: 2 }]
        }
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Storage.layer({ store, operationResponseBudget: Duration.millis(100) }),
            handlers
          )
        ),
        Effect.provideService(Connection, { marker: "borrowed" })
      )
      yield* start(worker)
      yield* Effect.yieldNow
      assert.equal(test.calls.claims.length, 1)
    })
  )
})

it("zero grace interrupts active executions and never releases after execution began", async () => {
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
      const activeHandlers = Group.handlers(group, (_handlers) =>
        _handlers.handle("neutral", () =>
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
          )
        )
      )
      const worker = yield* Worker.make(
        Effect.runSync(JobApi.make(group.name).pipe(JobApi.addGroup(group))),
        {
          queues: [{ queue, concurrency: 2 }]
        }
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Storage.layer({
              store: test.store,
              operationResponseBudget: Duration.millis(100)
            }),
            activeHandlers
          )
        )
      )
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(
        start(worker, { ...pollingOptions, shutdownGrace: Duration.millis(0) })
      )
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
