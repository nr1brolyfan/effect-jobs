import * as JobApi from "../../../src/JobApi.js"
import * as JobApiBuilder from "../../../src/JobApiBuilder.js"
import assert from "node:assert/strict"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Schema,
  Scope
} from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Group from "../../../src/JobGroup.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Polling from "../../../src/JobPolling.js"
import * as Storage from "../../../src/JobStorage.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import type { JobStoreService, JobOwnershipLost } from "../../../src/JobStore.js"
import { harness, policy } from "./Harness.js"

const queue = Queue.make("shutdown")
const definition = Effect.runSync(Job.make({ name: "shutdown", payload: Schema.String }))
const group = Group.make("shutdown", { run: definition })
const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(TestClock.layer(), Logger.layer([]))),
      Effect.scoped
    )
  )
const fixture = Effect.fnUntraced(function* (
  execute: Effect.Effect<void>,
  queues: ReadonlyArray<Queue.JobQueue> = [queue],
  configure: (
    store: JobStoreService<JobOwnershipLost>
  ) => JobStoreService<JobOwnershipLost> = (store) => store
) {
  const encoded = yield* Codec.encodeJobPayload(definition.payload, "fixture")
  const test = harness(
    queues.flatMap((selected) =>
      Array.from({ length: 4 }, (_, index) => ({
        catalog: {
          queue: selected.name,
          name: definition.name,
          version: definition.version
        },
        producer: {
          operation: "shutdown",
          operationId: `${selected.name}-${index}`,
          slot: "run"
        },
        policy,
        encoded
      }))
    )
  )
  const reached = yield* Deferred.make<void>()
  let started = 0
  let interrupted = 0
  const handlers = JobApiBuilder.group(
    JobApi.make(group.name).pipe(JobApi.addGroup(group)),
    group.name,
    (_handlers) =>
      _handlers.handle("run", () =>
        Effect.gen(function* () {
          started++
          if (started === 2) {
            yield* Deferred.succeed(reached, undefined)
          }
          return yield* execute.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted++
              })
            )
          )
        })
      )
  )
  const worker = yield* Worker.make(
    JobApi.make(group.name).pipe(JobApi.addGroup(group)),
    {
      queues: queues.map((selected) => ({
        queue: selected,
        concurrency: queues.length === 1 ? 2 : 1
      }))
    }
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        handlers,
        Storage.layer({
          store: configure(test.store),
          operationResponseBudgetMillis: 100
        })
      )
    )
  )
  // Polling must own its shutdown ordering, not depend on ambient sequential finalizers.
  const scope = yield* Scope.fork(yield* Scope.Scope, "parallel")
  const start = (shutdownGraceMillis?: number) =>
    Scope.provide(scope)(
      Layer.build(
        Polling.layer(queues, {
          maxJobs: 4,
          recoveryLimit: 1,
          ...(shutdownGraceMillis === undefined ? {} : { shutdownGraceMillis })
        }).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
      )
    )
  return {
    test,
    reached,
    scope,
    start,
    started: () => started,
    interrupted: () => interrupted
  }
})

it("stops admission blocked on permits while executions complete and finalize within grace", async () => {
  await run(
    Effect.gen(function* () {
      const complete = yield* Deferred.make<void>()
      const test = yield* fixture(Deferred.await(complete))
      yield* test.start(1000)
      yield* Deferred.await(test.reached)
      let closed = false
      const closing = yield* Scope.close(test.scope, Exit.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            closed = true
          })
        ),
        Effect.forkChild
      )
      yield* TestClock.adjust(500)
      assert.equal(closed, false)
      assert.equal(test.test.calls.claims.length, 2)
      yield* Deferred.succeed(complete, undefined)
      yield* Fiber.join(closing)
      assert.equal(test.interrupted(), 0)
      assert.equal(test.test.calls.releases, 0)
      assert.equal(test.test.calls.finalizations.length, 2)
      assert.deepEqual(
        test.test.rows.map((row) => row.snapshot.state),
        ["Completed", "Completed", "Pending", "Pending"]
      )
      assert.deepEqual(
        test.test.rows.map((row) => row.snapshot.finalizedAttempts),
        [1, 1, 0, 0]
      )
      yield* TestClock.adjust(60000)
      assert.equal(test.test.calls.claims.length, 2)
    })
  )
})

it.each([false, true])(
  "uses one grace deadline for all executions, multi-queue=%s",
  async (multiple) => {
    await run(
      Effect.gen(function* () {
        const queues = multiple ? [queue, Queue.make("shutdown-second")] : [queue]
        const test = yield* fixture(Effect.never, queues)
        yield* test.start(1000)
        yield* Deferred.await(test.reached)
        let closed = false
        const closing = yield* Scope.close(test.scope, Exit.void).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              closed = true
            })
          ),
          Effect.forkChild
        )
        yield* TestClock.adjust(999)
        assert.equal(closed, false)
        assert.equal(test.interrupted(), 0)
        assert.equal(test.test.calls.claims.length, 2)
        yield* TestClock.adjust(1)
        yield* Fiber.join(closing)
        assert.equal(test.interrupted(), 2)
        assert.equal(test.test.calls.releases, 0)
        assert.equal(test.test.calls.finalizations.length, 0)
        assert.equal(
          test.test.rows.filter((row) => row.snapshot.state === "Active").length,
          2
        )
        assert.ok(test.test.rows.every((row) => row.snapshot.finalizedAttempts === 0))
      })
    )
  }
)

it("default grace allows a short execution to finalize instead of interrupting immediately", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* fixture(Effect.sleep(500))
      yield* test.start()
      yield* Deferred.await(test.reached)
      const closing = yield* Scope.close(test.scope, Exit.void).pipe(Effect.forkChild)
      yield* TestClock.adjust(500)
      yield* Fiber.join(closing)
      assert.equal(test.interrupted(), 0)
      assert.equal(test.test.calls.finalizations.length, 2)
      assert.equal(test.test.calls.claims.length, 2)
    })
  )
})

it.each([false, true])(
  "preserves grace during application interruption, completes=%s",
  async (completes) => {
    await run(
      Effect.gen(function* () {
        const finish = yield* Deferred.make<void>()
        const test = yield* fixture(Deferred.await(finish))
        const owner = yield* test
          .start(1000)
          .pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Scope.close(test.scope, Exit.void)),
            Effect.forkChild
          )
        yield* Deferred.await(test.reached)
        const interrupting = yield* Fiber.interrupt(owner).pipe(Effect.forkChild)
        yield* TestClock.adjust(500)
        assert.equal(test.interrupted(), 0)
        assert.equal(test.test.calls.claims.length, 2)
        if (completes) {
          yield* Deferred.succeed(finish, undefined)
        } else {
          yield* TestClock.adjust(500)
        }
        yield* Fiber.join(interrupting)
        const exit = yield* Fiber.await(owner)
        assert.equal(Exit.isFailure(exit), true)
        assert.equal(test.interrupted(), completes ? 0 : 2)
        assert.equal(test.test.calls.finalizations.length, completes ? 2 : 0)
        assert.equal(test.test.calls.releases, 0)
      })
    )
  }
)

it("interrupted in-flight claim with a lost response stays unknown, never released or executed", async () => {
  await run(
    Effect.gen(function* () {
      const claimed = yield* Deferred.make<void>()
      const test = yield* fixture(Effect.void, [queue], (store) => ({
        ...store,
        claim: (request) =>
          store
            .claim(request)
            .pipe(
              Effect.andThen(Deferred.succeed(claimed, undefined)),
              Effect.andThen(Effect.never)
            )
      }))
      yield* test.start(1000)
      yield* Deferred.await(claimed)
      yield* Scope.close(test.scope, Exit.void)
      assert.equal(test.started(), 0)
      assert.equal(test.test.calls.releases, 0)
      assert.equal(test.test.calls.finalizations.length, 0)
      assert.equal(test.test.rows[0]!.snapshot.state, "Active")
      assert.equal(test.test.rows[0]!.snapshot.finalizedAttempts, 0)
    })
  )
})

it("forced shutdown during a lost finalization response does not rerun or release completed work", async () => {
  await run(
    Effect.gen(function* () {
      const committed = yield* Deferred.make<void>()
      const test = yield* fixture(Effect.void, [queue], (store) => ({
        ...store,
        finalize: (request) =>
          store
            .finalize(request)
            .pipe(
              Effect.andThen(Deferred.succeed(committed, undefined)),
              Effect.andThen(Effect.never)
            )
      }))
      yield* test.start(50)
      yield* Deferred.await(test.reached)
      yield* Deferred.await(committed)
      const closing = yield* Scope.close(test.scope, Exit.void).pipe(Effect.forkChild)
      yield* TestClock.adjust(50)
      yield* Fiber.join(closing)
      assert.equal(test.test.calls.finalizations.length, 2)
      assert.equal(test.test.calls.finalizationReconciliations.length, 0)
      assert.equal(test.test.calls.releases, 0)
      assert.equal(test.started(), 2)
      assert.deepEqual(
        test.test.rows.map((row) => row.snapshot.state),
        ["Completed", "Completed", "Pending", "Pending"]
      )
      yield* TestClock.adjust(60000)
      assert.equal(test.started(), 2)
    })
  )
})

it("retains provided handler resources until graceful finalization is done", async () => {
  class Resource extends Context.Service<
    Resource,
    { readonly execute: Effect.Effect<void> }
  >()("tests/shutdown/Resource") {}
  await run(
    Effect.gen(function* () {
      const encoded = yield* Codec.encodeJobPayload(definition.payload, "fixture")
      const test = harness([
        {
          catalog: {
            queue: queue.name,
            name: definition.name,
            version: definition.version
          },
          producer: { operation: "shutdown", operationId: "resource", slot: "run" },
          policy,
          encoded
        }
      ])
      const reached = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      let disposed = false
      const resources = Layer.effect(
        Resource,
        Effect.acquireRelease(
          Effect.succeed({
            execute: Deferred.succeed(reached, undefined).pipe(
              Effect.andThen(Deferred.await(finish))
            )
          }),
          () =>
            Effect.sync(() => {
              assert.equal(test.calls.finalizations.length, 1)
              disposed = true
            })
        )
      )
      const worker = Worker.layer(JobApi.make(group.name).pipe(JobApi.addGroup(group)), {
        queues: [{ queue }]
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            JobApiBuilder.group(
              JobApi.make(group.name).pipe(JobApi.addGroup(group)),
              group.name,
              (_handlers) =>
                _handlers.handle("run", () =>
                  Effect.flatMap(Resource, (resource) => resource.execute)
                )
            ),
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        ),
        Layer.provide(resources)
      )
      const scope = yield* Scope.fork(yield* Scope.Scope)
      yield* Scope.provide(scope)(
        Layer.build(
          Polling.layer([queue], { shutdownGraceMillis: 1000 }).pipe(
            Layer.provide(worker)
          )
        )
      )
      yield* Deferred.await(reached)
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* TestClock.adjust(500)
      assert.equal(disposed, false)
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(closing)
      assert.equal(disposed, true)
      assert.equal(test.rows[0]!.snapshot.state, "Completed")
    })
  )
})
