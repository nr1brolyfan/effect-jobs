import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
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
      class {
        close = vi.fn()
        send = vi.fn()
        constructor() {
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
})
