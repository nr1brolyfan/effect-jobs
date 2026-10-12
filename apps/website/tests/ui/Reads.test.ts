import { describe, expect, it } from "vitest"
import { Deferred, Effect, Fiber } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import { makeServer } from "./ReadsFixtures.js"

const run = <A, E>(operation: Effect.Effect<A, E, JobsClient>, client: Client) =>
  Effect.runPromise(operation.pipe(Effect.provideService(JobsClient, client)))

describe("stable authoritative reads and cursor history", () => {
  it("defaults to 20 and exposes only learned neighbors; 50 resets history", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      expect(state.snapshot().page?.items).toHaveLength(20)
      expect(state.snapshot().pagination).toEqual({
        pages: [1, 2],
        current: 1,
        hasPrevious: false,
        hasNext: true
      })
      await run(state.goTo(9), server.client)
      expect(server.requests).toHaveLength(1)
      await run(state.next, server.client)
      expect(state.snapshot().pagination.pages).toEqual([1, 2, 3])
      expect(server.requests.at(-1)?.cursor).toBe("read-job-019")
      await run(state.next, server.client)
      await run(state.next, server.client)
      expect(state.snapshot().page?.items).toHaveLength(5)
      expect(state.snapshot().pagination).toEqual({
        pages: [1, 2, 3, 4],
        current: 4,
        hasPrevious: true,
        hasNext: false
      })
      await run(state.previous, server.client)
      expect(server.requests.at(-1)?.cursor).toBe("read-job-039")
      await run(state.first, server.client)
      expect(server.requests.at(-1)?.cursor).toBeUndefined()
      expect(state.snapshot().pagination.pages).toEqual([1, 2, 3, 4])
      await run(state.setPageSize(50), server.client)
      expect(state.snapshot().page?.items).toHaveLength(50)
      expect(state.snapshot().pagination.pages).toEqual([1, 2])
      expect(server.requests.at(-1)?.limit).toBe(50)
      await run(state.next, server.client)
      expect(state.snapshot().page?.items).toHaveLength(15)
      await run(state.filter({ state: "Dead" }), server.client)
      expect(state.snapshot().pagination.pages).toEqual([1])
      expect(state.snapshot().stats?.total).toBe(65)
      expect(state.snapshot().page?.items).toHaveLength(0)
    } finally {
      state.dispose()
    }
  })

  it.each(["filter", "page", "size"] as const)(
    "retains rows/stats during delayed %s and labels failed replacement as previous results",
    async (action) => {
      const server = makeServer()
      const state = Atoms.make(Fixtures.sandbox)
      try {
        await run(state.refresh, server.client)
        const before = state.snapshot()
        await run(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const client: Client = {
              ...server.client,
              list: () =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.fail(new PlaygroundError({ code: "unavailable" }))
                  )
                )
            }
            const operation =
              action === "filter"
                ? state.filter({ state: "Dead" })
                : action === "page"
                  ? state.next
                  : state.setPageSize(50)
            const read = yield* Effect.forkChild(
              operation.pipe(Effect.provideService(JobsClient, client))
            )
            yield* Deferred.await(entered)
            const during = state.snapshot()
            expect(during.page).toBe(before.page)
            expect(during.stats).toBe(before.stats)
            expect(during.loading).toBe(true)
            expect(during.resultsCurrent).toBe(false)
            expect(during.displayedQuery).toEqual(before.displayedQuery)
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(read)
            expect(state.snapshot()).toMatchObject({
              loading: false,
              resultsCurrent: false,
              error: "unavailable",
              connection: "stale"
            })
            expect(state.snapshot().page).toBe(before.page)
            expect(state.snapshot().stats).toBe(before.stats)
          }),
          server.client
        )
        await run(state.refresh, server.client)
        expect(state.snapshot().resultsCurrent).toBe(true)
        expect(state.snapshot().error).toBeUndefined()
      } finally {
        state.dispose()
      }
    }
  )

  it.each(["success", "unavailable", "sandbox-expired", "defect"] as const)(
    "latest request owns loading/stats/errors while old read settles with %s",
    async (outcome) => {
      const server = makeServer()
      const state = Atoms.make(Fixtures.sandbox)
      try {
        await run(state.refresh, server.client)
        await run(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const client: Client = {
              ...server.client,
              list: (request) =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    outcome === "success"
                      ? server.client.list(request)
                      : outcome === "defect"
                        ? Effect.die("synthetic adapter defect")
                        : Effect.fail(new PlaygroundError({ code: outcome }))
                  )
                )
            }
            const old = yield* Effect.forkChild(
              state.next.pipe(Effect.provideService(JobsClient, client))
            )
            yield* Deferred.await(entered)
            server.insertFirst()
            yield* state.filter({ state: "Pending" })
            const current = state.snapshot()
            expect(current.loading).toBe(false)
            expect(state.reading()).toBe(false)
            expect(current.stats?.total).toBe(66)
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(old)
            expect(state.snapshot()).toEqual(current)
          }),
          server.client
        )
      } finally {
        state.dispose()
      }
    }
  )

  it("old completion cannot clear the newer delayed read's loading", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(
        Effect.gen(function* () {
          const enteredOld = yield* Deferred.make<void>()
          const releaseOld = yield* Deferred.make<void>()
          const enteredNew = yield* Deferred.make<void>()
          const releaseNew = yield* Deferred.make<void>()
          const delayed = (
            entered: Deferred.Deferred<void>,
            release: Deferred.Deferred<void>
          ): Client => ({
            ...server.client,
            describe: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(Fixtures.sandbox)
              )
          })
          const old = yield* Effect.forkChild(
            state.refresh.pipe(
              Effect.provideService(JobsClient, delayed(enteredOld, releaseOld))
            )
          )
          yield* Deferred.await(enteredOld)
          const latest = yield* Effect.forkChild(
            state
              .filter({ state: "Pending" })
              .pipe(Effect.provideService(JobsClient, delayed(enteredNew, releaseNew)))
          )
          yield* Deferred.await(enteredNew)
          yield* Deferred.succeed(releaseOld, undefined)
          yield* Fiber.join(old)
          expect(state.snapshot().loading).toBe(true)
          expect(server.requests).toHaveLength(0)
          yield* Deferred.succeed(releaseNew, undefined)
          yield* Fiber.join(latest)
          expect(state.snapshot().loading).toBe(false)
          expect(state.snapshot().resultsCurrent).toBe(true)
        }),
        server.client
      )
    } finally {
      state.dispose()
    }
  })

  it.each(["describe", "list", "detail"] as const)(
    "revokes rows/stats/details/history when %s rejects authority",
    async (boundary) => {
      const server = makeServer()
      const state = Atoms.make(Fixtures.sandbox)
      try {
        await run(state.refresh, server.client)
        await run(state.next, server.client)
        const jobId = state.snapshot().page!.items[0]!.jobId
        await run(state.select(jobId), server.client)
        const rejected: Client = {
          ...server.client,
          [boundary]: () => Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
        }
        await run(boundary === "detail" ? state.select(jobId) : state.refresh, rejected)
        expect(state.snapshot()).toMatchObject({
          page: undefined,
          stats: undefined,
          selected: undefined,
          detail: undefined,
          displayedQuery: undefined,
          loading: false,
          resultsCurrent: false,
          cursor: undefined,
          pageNumber: 1,
          pagination: { pages: [1] },
          error: "sandbox-expired"
        })
      } finally {
        state.dispose()
      }
    }
  )

  it("new generation clears private data before its delayed list replaces it", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      await run(state.next, server.client)
      await run(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const ref = { ...Fixtures.sandbox.ref, generation: 2 }
          const client: Client = {
            ...server.client,
            describe: () => Effect.succeed({ ...Fixtures.sandbox, ref }),
            list: (request) =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(server.client.list(request))
              )
          }
          const read = yield* Effect.forkChild(
            state.refresh.pipe(Effect.provideService(JobsClient, client))
          )
          yield* Deferred.await(entered)
          expect(state.snapshot()).toMatchObject({
            page: undefined,
            stats: undefined,
            displayedQuery: undefined,
            cursor: undefined,
            pageNumber: 1,
            pagination: { pages: [1] },
            loading: true
          })
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(read)
          expect(state.snapshot().displayedQuery?.sandbox).toEqual(ref)
        }),
        server.client
      )
    } finally {
      state.dispose()
    }
  })

  it("live inserts preserve keyset anchors and changed first-page boundaries prune descendants", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      await run(state.next, server.client)
      await run(state.next, server.client)
      const before = state.snapshot()
      server.insertFirst()
      await run(state.refresh, server.client)
      expect(state.snapshot().cursor).toBe(before.cursor)
      expect(state.snapshot().page?.items.map((job) => job.jobId)).toEqual(
        before.page?.items.map((job) => job.jobId)
      )
      expect(state.snapshot().stats?.total).toBe(66)
      await run(state.first, server.client)
      expect(state.snapshot().pagination.pages).toEqual([1, 2])
      expect(state.snapshot().page?.items[0]?.jobId).toBe("read-job--new")
      await run(state.goTo(3), server.client)
      expect(state.snapshot().pageNumber).toBe(1)
      server.removeFirst()
      await run(state.refresh, server.client)
      await run(state.next, server.client)
      expect(state.snapshot().page?.items[0]?.jobId).toBe("read-job-020")
    } finally {
      state.dispose()
    }
  })

  it("rapid known-page navigation publishes only the latest requested cursor", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      await run(state.next, server.client)
      await run(state.next, server.client)
      await run(state.first, server.client)
      await run(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const old = yield* Effect.forkChild(
            state.goTo(2).pipe(
              Effect.provideService(JobsClient, {
                ...server.client,
                list: (request) =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(server.client.list(request))
                  )
              })
            )
          )
          yield* Deferred.await(entered)
          yield* state.goTo(3)
          expect(state.snapshot().displayedQuery?.pageNumber).toBe(3)
          expect(state.snapshot().page?.items[0]?.jobId).toBe("read-job-040")
          expect(state.snapshot().loading).toBe(false)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(old)
          expect(state.snapshot().pageNumber).toBe(3)
          expect(state.snapshot().page?.items[0]?.jobId).toBe("read-job-040")
        }),
        server.client
      )
    } finally {
      state.dispose()
    }
  })

  it("sanitizes a latest adapter defect and rejects a page exceeding the requested size", async () => {
    const server = makeServer()
    const state = Atoms.make(Fixtures.sandbox)
    try {
      await run(state.refresh, server.client)
      const before = state.snapshot()
      await run(state.refresh, {
        ...server.client,
        list: () => Effect.die("private diagnostic must never enter UI")
      })
      expect(state.snapshot()).toMatchObject({ error: "unavailable", loading: false })
      expect(state.snapshot().page).toBe(before.page)
      expect(JSON.stringify(state.snapshot())).not.toContain("private diagnostic")
      await run(state.refresh, {
        ...server.client,
        list: (request) => server.client.list({ ...request, limit: 50 })
      })
      expect(state.snapshot().error).toBe("unavailable")
      expect(state.snapshot().page).toBe(before.page)
      expect(state.snapshot().stats).toBe(before.stats)
    } finally {
      state.dispose()
    }
  })
})
