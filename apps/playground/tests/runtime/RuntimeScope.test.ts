import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Exit, Scope } from "effect"
import { TestClock } from "effect/testing"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as FixtureClient from "../fixtures/FixtureClient.js"
import * as Runtime from "../../src/features/jobs/Runtime.js"

const browser = () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const window = Object.assign(new EventTarget(), {
    location: { href: "http://localhost:8787/jobs" },
    navigator: { onLine: true },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} }
  })
  vi.stubGlobal("document", document)
  vi.stubGlobal("window", window)
  return { document, window }
}
afterEach(() => vi.unstubAllGlobals())

describe("Effect-native dashboard lifetime", () => {
  it("drives periodic reads/clock through TestClock and releases the registry on parent close", async () => {
    const platform = browser()
    let descriptions = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const runtime = yield* Runtime.scoped(
          {
            ...FixtureClient.client,
            describe: () =>
              Effect.sync(() => {
                descriptions++
                return Fixtures.sandbox
              })
          },
          Fixtures.sandbox
        ).pipe(Scope.provide(scope))
        yield* TestClock.adjust(0)
        expect(descriptions).toBe(1)
        yield* TestClock.adjust(5_000)
        expect(descriptions).toBe(2)
        expect(runtime.registry.get(runtime.now)).toBe(5_000)
        platform.document.visibilityState = "hidden"
        platform.document.dispatchEvent(new Event("visibilitychange"))
        yield* TestClock.adjust(10_000)
        expect(descriptions).toBe(2)
        expect(runtime.registry.get(runtime.now)).toBe(5_000)
        platform.document.visibilityState = "visible"
        platform.document.dispatchEvent(new Event("visibilitychange"))
        yield* TestClock.adjust(0)
        expect(descriptions).toBe(3)
        yield* Scope.close(scope, Exit.void)
        expect(() => runtime.snapshot()).toThrow("registry is disposed")
        platform.window.dispatchEvent(new Event("online"))
        platform.document.dispatchEvent(new Event("visibilitychange"))
        yield* TestClock.adjust(10_000)
        expect(descriptions).toBe(3)
      }).pipe(Effect.provide(TestClock.layer()))
    )
  })

  it("pauses live sockets offline and opens a fresh lifetime on reconnect", async () => {
    const platform = browser()
    const sockets: Socket[] = []
    class Socket extends EventTarget {
      onmessage = null
      onclose = null
      onerror = null
      closes = 0
      close() {
        this.closes++
      }
      send() {}
      constructor() {
        super()
        sockets.push(this)
      }
    }
    vi.stubGlobal("WebSocket", Socket)
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const runtime = yield* Runtime.scoped(
          FixtureClient.client,
          { ...Fixtures.sandbox, expiresAt: 100_000 },
          { liveUrl: "ws://synthetic.test/changes" }
        ).pipe(Scope.provide(scope))
        yield* TestClock.adjust(0)
        expect(sockets).toHaveLength(1)
        platform.window.navigator.onLine = false
        platform.window.dispatchEvent(new Event("offline"))
        yield* TestClock.adjust(10_000)
        expect(sockets[0]!.closes).toBe(1)
        expect(sockets).toHaveLength(1)
        platform.window.navigator.onLine = true
        platform.window.dispatchEvent(new Event("online"))
        yield* TestClock.adjust(0)
        expect(sockets).toHaveLength(2)
        yield* Scope.close(scope, Exit.void)
        expect(sockets[1]!.closes).toBe(1)
        expect(() => runtime.snapshot()).toThrow("registry is disposed")
      }).pipe(Effect.provide(TestClock.layer()))
    )
  })
  it("reconciles a generation rotation discovered by the live read without waiting for the next poll", async () => {
    browser()
    class Socket extends EventTarget {
      onmessage = null
      onclose = null
      onerror = null
      close() {}
      send() {}
    }
    vi.stubGlobal("WebSocket", Socket)
    let generation = 1
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const runtime = yield* Runtime.scoped(
          {
            ...FixtureClient.client,
            describe: () =>
              Effect.sync(() => ({
                ...Fixtures.sandbox,
                ref: { ...Fixtures.sandbox.ref, generation },
                expiresAt: 100_000
              })),
            list: (request) =>
              Effect.succeed({ ...FixtureClient.page, sandbox: request.sandbox })
          },
          { ...Fixtures.sandbox, expiresAt: 100_000 },
          { liveUrl: "ws://synthetic.test/changes" }
        ).pipe(Scope.provide(scope))
        yield* TestClock.adjust(0)
        expect(runtime.snapshot().page?.sandbox.generation).toBe(1)
        generation = 2
        yield* TestClock.adjust(5_000)
        expect(runtime.snapshot().sandbox.ref.generation).toBe(2)
        expect(runtime.snapshot().page?.sandbox.generation).toBe(2)
        yield* Scope.close(scope, Exit.void)
      }).pipe(Effect.provide(TestClock.layer()))
    )
  })
})
