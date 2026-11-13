import { afterEach, describe, expect, it, vi } from "vitest"
import { Clock, Deferred, Effect, Exit, Scope } from "effect"
import { TestClock } from "effect/testing"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as FixtureClient from "../fixtures/FixtureClient.js"
import { JobsClient } from "../../src/features/jobs/Adapter.js"
import * as Runtime from "../../src/features/jobs/Runtime.js"

class Socket extends EventTarget {
  onmessage: ((event: { data: string }) => void) | null = null
  onclose = null
  onerror = null
  closes = 0
  close() {
    this.closes++
  }
  send() {}
  signal(sequence: number) {
    this.onmessage?.({
      data: JSON.stringify({
        kind: sequence === 1 ? "ready" : "invalidate",
        sandbox: Fixtures.sandbox.ref,
        reason: "jobs-changed",
        sequence
      })
    })
  }
}
afterEach(() => vi.unstubAllGlobals())

// Exercise the real Runtime -> BrowserLive -> Atoms publication path. Only the
// browser/client boundaries are synthetic; Effect scheduling uses TestClock.
describe("live dashboard publication", () => {
  for (const replacementFails of [false, true]) {
    it(`discards the invalidated list before a replacement ${replacementFails ? "failure" : "success"}`, async () => {
      const sockets: Socket[] = []
      vi.stubGlobal(
        "WebSocket",
        class extends Socket {
          constructor() {
            super()
            sockets.push(this)
          }
        }
      )
      vi.stubGlobal(
        "document",
        Object.assign(new EventTarget(), { visibilityState: "visible" })
      )
      vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
          location: { href: "http://localhost:8787/jobs" },
          navigator: { onLine: true },
          history: { pushState() {}, replaceState() {}, back() {} }
        })
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const entered = Deferred.makeUnsafe<void>()
          const release = Deferred.makeUnsafe<void>()
          let hold = false
          let replacing = false
          const published: number[] = []
          const runtime = yield* Runtime.scoped(
            {
              ...FixtureClient.client,
              describe: () => Effect.succeed({ ...Fixtures.sandbox, expiresAt: 100_000 }),
              list: () =>
                Effect.gen(function* () {
                  const count = hold ? 12 : 13
                  if (hold) {
                    hold = false
                    replacing = true
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                  } else if (replacing && replacementFails) {
                    return yield* new PlaygroundError({ code: "unavailable" })
                  }
                  return {
                    ...FixtureClient.page,
                    items: FixtureClient.page.items.slice(0, count),
                    filteredTotal: count,
                    stats: { ...FixtureClient.page.stats, total: count }
                  }
                })
            },
            { ...Fixtures.sandbox, expiresAt: 100_000 },
            {
              liveUrl: "ws://synthetic.test/changes"
            }
          ).pipe(Scope.provide(scope))
          yield* TestClock.adjust(0)
          sockets[0]!.signal(1)
          yield* TestClock.adjust(250)
          expect(runtime.snapshot().page?.filteredTotal).toBe(13)
          const previous = runtime.snapshot().page
          const unsubscribe = runtime.registry.subscribe(runtime.atoms.page, (page) => {
            if (page) {
              published.push(page.filteredTotal)
            }
          })
          hold = true
          sockets[0]!.signal(2)
          yield* TestClock.adjust(250)
          yield* Deferred.await(entered)
          sockets[0]!.signal(3)
          yield* Deferred.succeed(release, undefined)
          yield* TestClock.adjust(0)
          expect(published).toEqual([])
          expect(runtime.snapshot().page).toBe(previous)
          yield* TestClock.adjust(250)
          expect(published).toEqual(replacementFails ? [] : [13])
          expect(runtime.snapshot().page?.filteredTotal).toBe(13)
          expect(runtime.snapshot().connection).toBe(
            replacementFails ? "stale" : "connected"
          )
          unsubscribe()
          yield* Scope.close(scope, Exit.void)
          expect(sockets[0]!.closes).toBe(1)
        }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
      )
    })
  }
  for (const transition of ["hidden", "unmount", "expiry", "generation"] as const) {
    it(`fences a late integrated list after ${transition}`, async () => {
      const sockets: Socket[] = []
      vi.stubGlobal(
        "WebSocket",
        class extends Socket {
          constructor() {
            super()
            sockets.push(this)
          }
        }
      )
      const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
      vi.stubGlobal("document", document)
      vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
          location: { href: "http://localhost:8787/jobs" },
          navigator: { onLine: true },
          history: { pushState() {}, replaceState() {}, back() {} }
        })
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const entered = Deferred.makeUnsafe<void>()
          const release = Deferred.makeUnsafe<void>()
          let hold = false
          let generation = 1
          const published: number[] = []
          const client = {
            ...FixtureClient.client,
            describe: () =>
              Effect.gen(function* () {
                if ((yield* Clock.currentTimeMillis) >= 100_000) {
                  return yield* new PlaygroundError({ code: "sandbox-expired" })
                }
                return {
                  ...Fixtures.sandbox,
                  ref: { ...Fixtures.sandbox.ref, generation },
                  expiresAt: 100_000
                }
              }),
            list: (request: Parameters<typeof FixtureClient.client.list>[0]) =>
              Effect.gen(function* () {
                const count = hold ? 12 : 13
                if (hold) {
                  hold = false
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                }
                return {
                  ...FixtureClient.page,
                  sandbox: request.sandbox,
                  filteredTotal: count
                }
              })
          }
          const runtime = yield* Runtime.scoped(
            client,
            {
              ...Fixtures.sandbox,
              expiresAt: 100_000
            },
            { liveUrl: "ws://synthetic.test/changes" }
          ).pipe(Scope.provide(scope))
          yield* TestClock.adjust(0)
          expect(runtime.snapshot().page?.filteredTotal).toBe(13)
          const unsubscribe = runtime.registry.subscribe(runtime.atoms.page, (page) => {
            if (page) {
              published.push(page.filteredTotal)
            }
          })
          hold = true
          sockets[0]!.signal(1)
          yield* TestClock.adjust(250)
          yield* Deferred.await(entered)
          if (transition === "hidden") {
            document.visibilityState = "hidden"
            document.dispatchEvent(new Event("visibilitychange"))
          }
          if (transition === "unmount") {
            yield* Scope.close(scope, Exit.void)
          }
          if (transition === "expiry") {
            yield* TestClock.adjust(100_000)
          }
          if (transition === "generation") {
            generation = 2
            yield* runtime.refresh.pipe(Effect.provideService(JobsClient, client))
            yield* TestClock.adjust(0)
            expect(runtime.snapshot().page?.sandbox.generation).toBe(2)
          }
          yield* Deferred.succeed(release, undefined)
          yield* TestClock.adjust(0)
          expect(published).not.toContain(12)
          if (transition === "unmount") {
            expect(() => runtime.snapshot()).toThrow("registry is disposed")
          }
          if (transition === "expiry") {
            expect(runtime.snapshot().error).toBe("sandbox-expired")
            expect(runtime.snapshot().page).toBeUndefined()
          }
          unsubscribe()
          yield* Scope.close(scope, Exit.void)
          expect(sockets[0]!.closes).toBe(1)
        }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
      )
    })
  }
})
