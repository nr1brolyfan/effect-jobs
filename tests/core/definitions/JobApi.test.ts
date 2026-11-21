import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import * as Api from "../../../src/JobApi.js"
import * as Group from "../../../src/JobGroup.js"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Storage from "../../../src/JobStorage.js"
import { harness, policy } from "../worker/Harness.js"

const one = Effect.runSync(Job.make({ name: "catalog.one", payload: Schema.String }))
const two = Effect.runSync(Job.make({ name: "catalog.two", payload: Schema.Int }))
const first = Effect.runSync(Group.make("first", { run: one }))
const second = Effect.runSync(Group.make("second", { run: two }))
const api = Effect.runSync(
  Api.make("application").pipe(Api.addGroup(first), Api.addGroup(second))
)
const queue = Effect.runSync(Queue.make("catalog"))

describe("immutable catalogs and complete installation", () => {
  it("preserves earlier and sibling catalogs, exact schemas and distinct installation keys", () => {
    const empty = Effect.runSync(Api.make("application"))
    const a = Effect.runSync(Effect.succeed(empty).pipe(Api.addGroup(first)))
    const b = Effect.runSync(Effect.succeed(empty).pipe(Api.addGroup(second)))
    expect(empty.groups).toEqual({})
    expect(Object.keys(a.groups)).toEqual(["first"])
    expect(Object.keys(b.groups)).toEqual(["second"])
    expect(a.groups.first.definitions.run.payload).toBe(one.payload)
    expect(a.groups.first.handlers).toBe(first.handlers)
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(a.groups)).toBe(true)
    expect(Object.isFrozen(a.groups.first.definitions)).toBe(true)
  })

  it("rejects duplicate names and cross-group contracts but permits aliases and versions", () => {
    const setup = Effect.succeed(api)
    const duplicate = setup.pipe(
      // @ts-expect-error Known duplicate group names cannot be added.
      Api.addGroup(first)
    )
    const third = Effect.runSync(Group.make("third", { other: one }))
    const newVersion = Effect.runSync(
      Group.make("third", { run: { ...one, version: 2 } })
    )
    const malformed = { ...first, definitions: { run: null } } as unknown as typeof first
    for (const [effect, reason] of [
      [duplicate, "duplicate-group"],
      [setup.pipe(Api.addGroup(third)), "duplicate-contract"],
      [Api.make("INVALID"), "invalid-name"],
      [Api.make("app").pipe(Api.addGroup(malformed)), "invalid-group"]
    ] as const) {
      expect(
        Effect.runSync(Effect.result<unknown, Api.InvalidJobApi, never>(effect))
      ).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidJobApi", reason }
      })
    }
    expect(
      Effect.runSync(setup.pipe(Api.addGroup(newVersion))).groups.third.definitions.run
        .version
    ).toBe(2)
  })

  it("picks original declarations and rejects unknown or inherited group names", () => {
    const picked = Effect.runSync(Api.pick(api, ["first"]))
    expect(picked.name).toBe(api.name)
    expect(Object.keys(api.groups)).toEqual(["first", "second"])
    expect(Object.keys(picked.groups)).toEqual(["first"])
    expect(picked.groups.first).toBe(api.groups.first)
    expect(picked.groups.first.handlers).toBe(first.handlers)
    expect(Object.isFrozen(picked.groups)).toBe(true)
    for (const name of ["missing", "constructor"]) {
      const result = Effect.runSync(
        Effect.result(Api.pick(api, ["first", name as "second"]))
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidJobApi", reason: "unknown-group" }
      })
    }
  })

  it("snapshots a mutable selection before either execution", () => {
    const names: ["first", "second"] = ["first", "second"]
    const setup = Api.pick(api, names)
    expect(names.pop()).toBe("second")
    const initial = Effect.runSync(setup)
    const repeated = Effect.runSync(setup)
    for (const picked of [initial, repeated]) {
      expect(Object.keys(picked.groups)).toEqual(["first", "second"])
      expect(picked.groups.second.definitions.run.payload).toBe(two.payload)
      expect(picked.groups.first.handlers).toBe(first.handlers)
      expect(picked.groups.second.handlers).toBe(second.handlers)
    }
    expect(Object.keys(api.groups)).toEqual(["first", "second"])
  })

  it("defers build and invocation, captures acquisition dependencies once and permits immutable branches", async () => {
    class Dependency extends Context.Service<Dependency, { readonly value: string }>()(
      "tests/catalog/dependency"
    ) {}
    let acquired = 0
    const received: string[] = []
    const handlers = Group.handlers(first, (h) =>
      Effect.gen(function* () {
        acquired++
        const dependency = yield* Dependency
        const complete = h.handle("run", (input) =>
          Effect.sync(() => {
            received.push(dependency.value + input.payload)
          })
        )
        expect(Object.isFrozen(h)).toBe(true)
        expect(Object.isFrozen(complete)).toBe(true)
        return complete
      })
    )
    expect(acquired).toBe(0)
    expect(received).toEqual([])
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(one.payload, "one")
        const test = harness(
          [0, 1].map((index) => ({
            catalog: { queue: queue.name, name: one.name, version: one.version },
            producer: { operation: "catalog", operationId: String(index), slot: "run" },
            policy,
            encoded
          }))
        )
        const worker = yield* Worker.make(yield* Api.pick(api, ["first"]), {
          queues: [{ queue }]
        }).pipe(
          Effect.provide(
            Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
          )
        )
        expect(received).toEqual([])
        yield* worker.drain(queue)
        expect(acquired).toBe(1)
        expect(received).toEqual(["prefix:one", "prefix:one"])
      }).pipe(
        Effect.provide(handlers),
        Effect.provideService(Dependency, { value: "prefix:" }),
        Effect.provide(TestClock.layer())
      )
    )
  })

  it("fails incomplete, duplicate, unknown, foreign and forged builders in Layer E", async () => {
    /* oxlint-disable effecttsgo/any-unknown-in-error-context -- Invalid static calls deliberately fall back to existential constraints for runtime bypass tests. */
    const builds = [
      // @ts-expect-error Incomplete implementation cannot install.
      Group.handlers(first, (h) => h),
      Group.handlers(first, (h) =>
        h
          .handle("run", () => Effect.void)
          // @ts-expect-error An alias is available once only.
          .handle("run", () => Effect.void)
      ),
      Group.handlers(first, (h) =>
        h
          // @ts-expect-error Unknown aliases cannot install.
          .handle("foreign", () => Effect.void)
      ),
      // @ts-expect-error A record is not a complete builder.
      Group.handlers(first, () => ({ run: () => Effect.void }))
    ]
    for (const layer of builds) {
      const result = await Effect.runPromise(
        Effect.void.pipe(
          // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Intentional type bypass of invalid builders with no dependencies.
          Effect.provide(layer as Layer.Layer<unknown, Group.JobGroupConfigurationError>),
          Effect.result
        )
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "JobGroupConfigurationError", reason: "invalid-handlers" }
      })
    }
    /* oxlint-enable effecttsgo/any-unknown-in-error-context */
    let foreign: Group.HandlerBuilder<typeof first.definitions, never> | undefined
    const original = Group.handlers(first, (h) => {
      foreign = h.handle("run", () => Effect.void)
      return foreign
    })
    await Effect.runPromise(Effect.void.pipe(Effect.provide(original)))
    const other = Effect.runSync(Group.make("first", { run: one }))
    const unrelated = Group.handlers(other, () => foreign!)
    expect(
      await Effect.runPromise(Effect.void.pipe(Effect.provide(unrelated), Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { reason: "invalid-handlers" } })
  })

  it("safely rejects an empty catalog and unrelated same-shaped installation", async () => {
    const test = harness()
    const same = Effect.runSync(Group.make("first", { run: one }))
    const installed = Group.handlers(first, (h) => h.handle("run", () => Effect.void))
    for (const catalog of [
      Effect.runSync(Api.make("empty")),
      Effect.runSync(Api.make("app").pipe(Api.addGroup(same)))
    ]) {
      const result = await Effect.runPromise(
        Worker.make(catalog, { queues: [{ queue }] }).pipe(
          Effect.provide(
            Layer.mergeAll(
              installed,
              Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
            )
          ),
          Effect.result
        )
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "JobWorkerConfigurationError", field: "catalog" }
      })
    }
    expect(test.calls.claims).toEqual([])
  })

  it("dispatches every group/version across shared queues with one concurrency budget", async () => {
    const third = Effect.runSync(
      Group.make("third", {
        run: Effect.runSync(Job.make({ ...one, version: 2 }))
      })
    )
    const all = Effect.runSync(Effect.succeed(api).pipe(Api.addGroup(third)))
    const slow = Effect.runSync(Queue.make("catalog-slow"))
    const seen: string[] = []
    const active = new Map<string, number>()
    const maxima = new Map<string, number>()
    await Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const execute = (input: {
          readonly payload: unknown
          readonly context: {
            readonly catalog: {
              readonly queue: string
              readonly name: string
              readonly version: number
            }
          }
        }) =>
          Effect.gen(function* () {
            const identity = input.context.catalog
            const current = (active.get(identity.queue) ?? 0) + 1
            active.set(identity.queue, current)
            maxima.set(identity.queue, Math.max(current, maxima.get(identity.queue) ?? 0))
            seen.push(
              `${identity.queue}/${identity.name}/${identity.version}/${String(input.payload)}`
            )
            if ((active.get(queue.name) ?? 0) + (active.get(slow.name) ?? 0) === 3) {
              yield* Deferred.succeed(ready, undefined)
            }
            yield* Deferred.await(release).pipe(
              Effect.ensuring(
                Effect.sync(() =>
                  active.set(identity.queue, active.get(identity.queue)! - 1)
                )
              )
            )
          })
        const prepared = yield* Effect.forEach([queue, slow], (destination) =>
          Effect.forEach([one, two, third.definitions.run], (job) =>
            Effect.gen(function* () {
              const encoded = yield* Codec.encodeJobPayload(
                job.payload,
                job.name === two.name ? 42 : "one"
              )
              return {
                catalog: {
                  queue: destination.name,
                  name: job.name,
                  version: job.version
                },
                producer: {
                  operation: "catalog",
                  operationId: `${destination.name}/${job.name}/${job.version}`,
                  slot: "run"
                },
                policy,
                encoded
              }
            })
          )
        )
        const test = harness(prepared.flat())
        const worker = yield* Worker.make(all, {
          queues: [
            { queue, concurrency: 2 },
            { queue: slow, concurrency: 1 }
          ]
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Group.handlers(first, (h) => h.handle("run", execute)),
              Group.handlers(second, (h) => h.handle("run", execute)),
              Group.handlers(third, (h) => h.handle("run", execute)),
              Storage.layer({ store: test.store, operationResponseBudgetMillis: 100 })
            )
          )
        )
        const drains = yield* Effect.forkScoped(
          Effect.all(
            [
              worker.drain(queue),
              worker.drain(queue),
              worker.drain(slow),
              worker.drain(slow)
            ],
            { concurrency: "unbounded" }
          )
        )
        yield* Deferred.await(ready)
        expect(maxima.get(queue.name)).toBe(2)
        expect(maxima.get(slow.name)).toBe(1)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(drains)
        expect(seen).toHaveLength(6)
        expect(new Set(seen).size).toBe(6)
        expect(
          test.rows.every(
            (row) =>
              row.snapshot.state === "Completed" && row.snapshot.finalizedAttempts === 1
          )
        ).toBe(true)
        expect(maxima.get(queue.name)).toBe(2)
        expect(maxima.get(slow.name)).toBe(1)
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
    )
  })
})
