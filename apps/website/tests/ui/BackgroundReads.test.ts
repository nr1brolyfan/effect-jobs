import { describe, expect, it } from "vitest"
import { Deferred, Effect, Fiber } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import { makeServer } from "./ReadsFixtures.js"

const run = <A, E>(operation: Effect.Effect<A, E, JobsClient>, client: Client) =>
  Effect.runPromise(operation.pipe(Effect.provideService(JobsClient, client)))

describe("silent background reads and live filtered totals", () => {
  it("keeps every observed successful background cycle current, connected and idle", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      server.keep(50)
      await run(state.refresh, server.client)
      expect(state.snapshot().pagination).toMatchObject({
        total: 50,
        pageCount: 3,
        pages: [1, 2]
      })
      const observed: Array<unknown> = []
      const unsubscribe = state.registry.subscribe(state.stateAtom, (value) => {
        observed.push([
          value.loading,
          value.resultsCurrent,
          value.connection,
          value.notice
        ])
      })
      for (let index = 0; index < 40; index++) {
        await run(state.backgroundRefresh, server.client)
        expect(state.snapshot()).toMatchObject({
          loading: false,
          resultsCurrent: true,
          connection: "connected",
          notice: ""
        })
      }
      unsubscribe()
      expect(observed.length).toBeGreaterThan(0)
      expect(
        observed.every(
          (value) =>
            JSON.stringify(value) === JSON.stringify([false, true, "connected", ""])
        )
      ).toBe(true)
      server.insertFirst()
      await run(state.backgroundRefresh, server.client)
      expect(state.snapshot().pagination).toMatchObject({ total: 51, pageCount: 3 })
      await run(state.setPageSize(50), server.client)
      expect(state.snapshot().pagination).toMatchObject({ total: 51, pageCount: 2 })
      await run(state.filter({ state: "Dead" }), server.client)
      expect(state.snapshot().pagination).toMatchObject({
        total: 0,
        pageCount: 0,
        pages: [1]
      })
      expect(state.snapshot().stats?.total).toBe(51)
    } finally {
      state.dispose()
    }
  })

  it.each([20, 50] as const)(
    "recovers a vanished cursor page at size %s with one bounded first-page read",
    async (size) => {
      const server = makeServer()
      const state = Atoms.make(Fixtures.sandbox)
      try {
        await run(state.setPageSize(size), server.client)
        await run(state.refresh, server.client)
        await run(state.next, server.client)
        expect(state.snapshot().pageNumber).toBe(2)
        server.keep(5)
        const before = server.requests.length
        await run(state.backgroundRefresh, server.client)
        expect(server.requests.length - before).toBe(2)
        expect(server.requests.at(-1)?.cursor).toBeUndefined()
        expect(state.snapshot()).toMatchObject({
          loading: false,
          resultsCurrent: true,
          pageNumber: 1,
          displayedQuery: { pageNumber: 1, pageSize: size },
          pagination: { total: 5, pageCount: 1, pages: [1] }
        })
        expect(state.snapshot().page?.items).toHaveLength(5)
      } finally {
        state.dispose()
      }
    }
  )

  it("prunes old numbered controls beyond a shrinking live ceiling while the current page is still valid", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      await run(state.next, server.client)
      await run(state.next, server.client)
      await run(state.first, server.client)
      expect(state.snapshot().pagination.pages).toEqual([1, 2, 3, 4])
      server.keep(25)
      await run(state.backgroundRefresh, server.client)
      expect(state.snapshot().pagination).toMatchObject({
        total: 25,
        pageCount: 2,
        pages: [1, 2]
      })
      const before = server.requests.length
      await run(state.goTo(3), server.client)
      expect(server.requests.length).toBe(before)
      await run(state.goTo(2), server.client)
      expect(state.snapshot().page?.items).toHaveLength(5)
    } finally {
      state.dispose()
    }
  })

  it.each(["success", "unavailable", "sandbox-expired", "defect"] as const)(
    "fences old background %s behind the latest foreground query",
    async (outcome) => {
      const server = makeServer()
      const state = Atoms.make(Fixtures.sandbox)
      try {
        await run(state.refresh, server.client)
        await run(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const old = yield* Effect.forkChild(
              state.backgroundRefresh.pipe(
                Effect.provideService(JobsClient, {
                  ...server.client,
                  list: (request) =>
                    Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                      Effect.andThen(
                        outcome === "success"
                          ? server.client.list(request)
                          : outcome === "defect"
                            ? Effect.die("private defect")
                            : Effect.fail(new PlaygroundError({ code: outcome }))
                      )
                    )
                })
              )
            )
            yield* Deferred.await(entered)
            expect(state.reading()).toBe(true)
            expect(state.snapshot().loading).toBe(false)
            yield* state.filter({ state: "Dead" })
            const latest = state.snapshot()
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(old)
            expect(state.snapshot()).toEqual(latest)
            expect(state.reading()).toBe(false)
          }),
          server.client
        )
      } finally {
        state.dispose()
      }
    }
  )

  it("ignores background and repeated next demand during delayed foreground navigation", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      await run(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let calls = 0
          const delayed: Client = {
            ...server.client,
            list: (request) => {
              calls++
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(server.client.list(request))
              )
            }
          }
          const read = yield* Effect.forkChild(
            state.next.pipe(Effect.provideService(JobsClient, delayed))
          )
          yield* Deferred.await(entered)
          for (let index = 0; index < 10; index++) {
            yield* state.backgroundRefresh.pipe(
              Effect.provideService(JobsClient, delayed)
            )
            yield* state.next.pipe(Effect.provideService(JobsClient, delayed))
            yield* state.goTo(2).pipe(Effect.provideService(JobsClient, delayed))
          }
          expect(calls).toBe(1)
          expect(state.snapshot()).toMatchObject({
            loading: true,
            resultsCurrent: false,
            pageNumber: 2,
            displayedQuery: { pageNumber: 1 }
          })
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(read)
          expect(state.snapshot()).toMatchObject({
            loading: false,
            resultsCurrent: true,
            pageNumber: 2
          })
        }),
        server.client
      )
    } finally {
      state.dispose()
    }
  })

  it("shows real background failure, clears revoked data and accepts new generation", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      const page = state.snapshot().page
      await run(state.backgroundRefresh, {
        ...server.client,
        list: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
      })
      expect(state.snapshot()).toMatchObject({
        loading: false,
        connection: "stale",
        error: "unavailable",
        resultsCurrent: true
      })
      expect(state.snapshot().page).toBe(page)
      await run(state.backgroundRefresh, {
        ...server.client,
        describe: () => Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
      })
      expect(state.snapshot()).toMatchObject({
        page: undefined,
        stats: undefined,
        displayedQuery: undefined,
        error: "sandbox-expired"
      })
      const ref = { ...Fixtures.sandbox.ref, generation: 2 }
      await run(state.backgroundRefresh, {
        ...server.client,
        describe: () => Effect.succeed({ ...Fixtures.sandbox, ref })
      })
      expect(state.snapshot().displayedQuery?.sandbox).toEqual(ref)
      expect(state.snapshot().pagination.pages).toEqual([1, 2])
    } finally {
      state.dispose()
    }
  })
})
