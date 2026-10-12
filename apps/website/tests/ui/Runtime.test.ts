import { afterEach, describe, expect, it, vi } from "vitest"
import { Deferred, Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { makeServer } from "./ReadsFixtures.js"
import * as Runtime from "../../src/features/jobs/Runtime.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"

const browser = () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const window = new EventTarget()
  vi.stubGlobal("document", document)
  vi.stubGlobal("window", window)
  return { document, window }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("mounted Effect Scope", () => {
  it("keeps polling and visibility reconciliation silent across many observed cycles and recovers actual offline status", async () => {
    const { document, window } = browser()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const server = makeServer()
    server.keep(50)
    const runtime = Runtime.make(server.client, Fixtures.sandbox)
    try {
      await runtime.run(runtime.refresh)
      const observed: Array<unknown> = []
      const unsubscribe = runtime.registry.subscribe(runtime.stateAtom, (value) => {
        observed.push([
          value.loading,
          value.resultsCurrent,
          value.connection,
          value.notice
        ])
      })
      for (let index = 0; index < 20; index++) {
        await vi.advanceTimersByTimeAsync(5000)
        document.dispatchEvent(new Event("visibilitychange"))
        await runtime.run(runtime.backgroundRefresh)
        expect(runtime.snapshot().pagination).toMatchObject({ total: 50, pageCount: 3 })
      }
      unsubscribe()
      expect(server.requests.length).toBeGreaterThan(20)
      expect(observed.length).toBeGreaterThan(0)
      expect(
        observed.every(
          (value) =>
            JSON.stringify(value) === JSON.stringify([false, true, "connected", ""])
        )
      ).toBe(true)
      window.dispatchEvent(new Event("offline"))
      expect(runtime.snapshot().connection).toBe("stale")
      window.dispatchEvent(new Event("online"))
      await vi.waitFor(() => expect(runtime.snapshot().connection).toBe("connected"))
    } finally {
      await runtime.dispose()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it("interrupts an outstanding request, removes events/timers, and permits a fresh lifetime", async () => {
    const { document, window } = browser()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let descriptions = 0
    let interruptions = 0
    let enter: () => void = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const client = {
      ...FixtureClient.client,
      describe: () =>
        Effect.gen(function* () {
          ++descriptions
          enter()
          return yield* Effect.never
        }).pipe(Effect.ensuring(Effect.sync(() => ++interruptions)))
    }
    const first = Runtime.make(client, Fixtures.sandbox)
    await entered
    expect(first.reading()).toBe(true)
    await first.dispose()
    expect(interruptions).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(descriptions).toBe(1)
    expect(() => first.snapshot()).toThrow("registry is disposed")
    const second = Runtime.make(FixtureClient.client, Fixtures.sandbox, { poll: false })
    await second.run(second.refresh)
    expect(second.snapshot().connection).toBe("connected")
    expect(second.registry).not.toBe(first.registry)
    await second.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("owns and closes the WebSocket alongside HTTP reads", async () => {
    browser()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const sockets: Array<{ close: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal(
      "WebSocket",
      class extends EventTarget {
        close = vi.fn()
        send = vi.fn()
        constructor() {
          super()
          sockets.push(this)
        }
      }
    )
    const runtime = Runtime.make(
      FixtureClient.client,
      { ...Fixtures.sandbox, expiresAt: Date.now() + 60_000 },
      {
        liveUrl: "ws://synthetic.test/changes"
      }
    )
    await runtime.run(runtime.refresh)
    expect(sockets).toHaveLength(1)
    await runtime.dispose()
    expect(sockets[0]?.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reconciles a WebSocket invalidation through HTTP without clearing retained rows/stats", async () => {
    browser()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const sockets: Array<Socket> = []
    class Socket extends EventTarget {
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: ((event: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      send = vi.fn()
      constructor() {
        super()
        sockets.push(this)
      }
    }
    vi.stubGlobal("WebSocket", Socket)
    const server = makeServer()
    const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 60_000 }
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    let delayed = false
    const client = {
      ...server.client,
      describe: () => Effect.succeed(sandbox),
      list: (request: Parameters<typeof server.client.list>[0]) =>
        delayed
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(server.client.list(request))
            )
          : server.client.list(request)
    }
    const runtime = Runtime.make(client, sandbox, {
      liveUrl: "ws://synthetic.test/changes"
    })
    try {
      await runtime.run(runtime.refresh)
      const before = runtime.snapshot()
      delayed = true
      server.insertFirst()
      sockets[0]!.onmessage!({
        data: JSON.stringify({
          kind: "ready",
          sandbox: sandbox.ref,
          reason: "jobs-changed",
          sequence: 1
        })
      })
      await Effect.runPromise(Deferred.await(entered))
      expect(runtime.snapshot().page).toBe(before.page)
      expect(runtime.snapshot().stats).toBe(before.stats)
      expect(runtime.snapshot().loading).toBe(false)
      expect(runtime.snapshot().resultsCurrent).toBe(true)
      expect(runtime.snapshot().connection).toBe("connected")
      expect(runtime.reading()).toBe(true)
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await vi.waitFor(() => expect(runtime.snapshot().stats?.total).toBe(66))
      expect(runtime.snapshot().page?.items[0]?.jobId).toBe("read-job--new")
      expect(runtime.snapshot().loading).toBe(false)
      expect(sockets[0]!.send).toHaveBeenCalledWith(
        JSON.stringify({ kind: "ack", sequence: 1 })
      )
      const oldSocket = sockets[0]!
      oldSocket.onerror!()
      expect(runtime.snapshot().connection).toBe("reconnecting")
      await runtime.run(runtime.backgroundRefresh)
      expect(runtime.snapshot().connection).toBe("reconnecting")
      await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2000 })
      oldSocket.dispatchEvent(Object.assign(new Event("close"), { code: 4003 }))
      expect(runtime.snapshot().stats?.total).toBe(66)
      expect(runtime.snapshot().error).toBeUndefined()
      expect(runtime.snapshot().connection).toBe("reconnecting")
      sockets[1]!.onmessage!({
        data: JSON.stringify({
          kind: "ready",
          sandbox: sandbox.ref,
          reason: "jobs-changed",
          sequence: 1
        })
      })
      expect(runtime.snapshot().connection).toBe("connected")
      expect(runtime.snapshot().loading).toBe(false)
    } finally {
      await runtime.dispose()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it("WebSocket admission revocation fences an in-flight private read immediately", async () => {
    browser()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const sockets: Array<Socket> = []
    class Socket extends EventTarget {
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: ((event: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      send = vi.fn()
      constructor() {
        super()
        sockets.push(this)
      }
    }
    vi.stubGlobal("WebSocket", Socket)
    const server = makeServer()
    const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 60_000 }
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    let delayed = false
    let expired = false
    const runtime = Runtime.make(
      {
        ...server.client,
        describe: () =>
          expired
            ? Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
            : Effect.succeed(sandbox),
        list: (request) =>
          delayed
            ? Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(server.client.list(request))
              )
            : server.client.list(request)
      },
      sandbox,
      { liveUrl: "ws://synthetic.test/changes" }
    )
    try {
      await runtime.run(runtime.refresh)
      await runtime.run(runtime.next)
      delayed = true
      const old = runtime.run(runtime.refresh)
      await Effect.runPromise(Deferred.await(entered))
      expired = true
      const event = Object.assign(new Event("close"), { code: 4003 })
      sockets[0]!.dispatchEvent(event)
      expect(runtime.snapshot()).toMatchObject({
        page: undefined,
        stats: undefined,
        displayedQuery: undefined,
        pagination: { pages: [1] },
        error: "sandbox-expired"
      })
      sockets[0]!.onclose!({ code: 4003 })
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await old
      expect(runtime.snapshot().page).toBeUndefined()
      expect(runtime.snapshot().stats).toBeUndefined()
    } finally {
      await runtime.dispose()
    }
    expect(vi.getTimerCount()).toBe(0)
  })
})
