import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import * as Api from "../../../src/JobApi.js"
import * as Builder from "../../../src/JobApiBuilder.js"
import * as Group from "../../../src/JobGroup.js"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Storage from "../../../src/JobStorage.js"
import { harness, policy } from "../worker/Harness.js"

const one = Effect.runSync(Job.make({ name: "catalog.one", payload: Schema.String }))
const two = Effect.runSync(Job.make({ name: "catalog.two", payload: Schema.Int }))
const first = Group.make("first", { run: one })
const second = Group.make("second", { run: two })
const api = Api.make("application").pipe(Api.addGroup(first), Api.addGroup(second))
const queue = Queue.make("catalog")

describe("immutable catalogs and complete installation", () => {
  it("preserves earlier and sibling catalogs, exact schemas and distinct installation keys", () => {
    const empty = Api.make("application")
    const a = empty.pipe(Api.addGroup(first))
    const b = empty.pipe(Api.addGroup(second))
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
    // @ts-expect-error Known duplicate group names cannot be added.
    expect(() => api.pipe(Api.addGroup(first))).toThrow(Api.InvalidJobApi)
    expect(() => api.pipe(Api.addGroup(Group.make("third", { other: one })))).toThrow(
      Api.InvalidJobApi
    )
    expect(() =>
      api.pipe(
        Api.addGroup(
          Group.make("third", { run: Effect.runSync(Job.make({ ...one, version: 2 })) })
        )
      )
    ).not.toThrow()
    expect(() => Api.make("INVALID")).toThrow(Api.InvalidJobApi)
    expect(() =>
      Api.addGroup({ ...first, definitions: { run: null } } as unknown as typeof first)(
        Api.make("app")
      )
    ).toThrow(Api.InvalidJobApi)
  })

  it("defers build and invocation, captures acquisition dependencies once and permits immutable branches", async () => {
    class Dependency extends Context.Service<Dependency, { readonly value: string }>()(
      "tests/catalog/dependency"
    ) {}
    let acquired = 0
    const received: string[] = []
    const handlers = Builder.group(api, "first", (h) =>
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
        const worker = yield* Worker.make(Api.make("app").pipe(Api.addGroup(first)), {
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
      Builder.group(api, "first", (h) => h),
      Builder.group(api, "first", (h) =>
        h
          .handle("run", () => Effect.void)
          // @ts-expect-error An alias is available once only.
          .handle("run", () => Effect.void)
      ),
      Builder.group(api, "first", (h) =>
        h
          // @ts-expect-error Unknown aliases cannot install.
          .handle("foreign", () => Effect.void)
      ),
      // @ts-expect-error Unknown groups cannot install.
      Builder.group(api, "missing", (h) => h),
      // @ts-expect-error Inherited object properties are not declared groups.
      Builder.group(api, "constructor", (h) => h),
      // @ts-expect-error A record is not a complete builder.
      Builder.group(api, "first", () => ({ run: () => Effect.void }))
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
    let foreign: Builder.Handlers<typeof first.definitions, never> | undefined
    const original = Builder.group(api, "first", (h) => {
      foreign = h.handle("run", () => Effect.void)
      return foreign
    })
    await Effect.runPromise(Effect.void.pipe(Effect.provide(original)))
    const other = Group.make("first", { run: one })
    const unrelated = Builder.group(
      Api.make("app").pipe(Api.addGroup(other)),
      "first",
      () => foreign!
    )
    expect(
      await Effect.runPromise(Effect.void.pipe(Effect.provide(unrelated), Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { reason: "invalid-handlers" } })
  })

  it("safely rejects an empty catalog and unrelated same-shaped installation", async () => {
    const test = harness()
    const same = Group.make("first", { run: one })
    const installed = Builder.group(api, "first", (h) =>
      h.handle("run", () => Effect.void)
    )
    for (const catalog of [Api.make("empty"), Api.make("app").pipe(Api.addGroup(same))]) {
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
    const third = Group.make("third", {
      run: Effect.runSync(Job.make({ ...one, version: 2 }))
    })
    const all = api.pipe(Api.addGroup(third))
    const slow = Queue.make("catalog-slow")
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
              Builder.group(all, "first", (h) => h.handle("run", execute)),
              Builder.group(all, "second", (h) => h.handle("run", execute)),
              Builder.group(all, "third", (h) => h.handle("run", execute)),
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
