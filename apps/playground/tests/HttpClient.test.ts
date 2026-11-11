import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { Cause, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import type * as HttpClient from "../src/integration/HttpClient.js"

let http: typeof HttpClient
beforeAll(async () => {
  vi.stubGlobal("location", { origin: "http://localhost" })
  vi.stubGlobal("document", { cookie: "" })
  http = await import("../src/integration/HttpClient.js")
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => vi.unstubAllGlobals())

// Native fetch/body are the only simulated boundary; real Effect owns abort,
// timeout, decoding and publication. Every pending body is settled in finally.
const pendingBody = (honorAbort = true) => {
  const entered = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<void>()
  let body: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller
      }
    })
  )
  const json = response.json.bind(response)
  vi.spyOn(response, "json").mockImplementation(() => {
    entered.resolve()
    return json().finally(completed.resolve)
  })
  let signal: AbortSignal | null | undefined
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_path, options) => {
    signal = options?.signal
    if (honorAbort) {
      signal?.addEventListener("abort", () => body.error(signal?.reason), { once: true })
    }
    return Promise.resolve(response)
  })
  return {
    entered: entered.promise,
    completed: completed.promise,
    signal: () => signal,
    fetch,
    finish: () => {
      if (!honorAbort || !signal?.aborted) {
        body.enqueue(new TextEncoder().encode(JSON.stringify(Fixtures.sandbox)))
        body.close()
      }
    }
  }
}

describe("HTTP fetch and body cancellation lifetime", () => {
  it("aborts before headers without replaying POST", async () => {
    const entered = Promise.withResolvers<void>()
    const native = Promise.withResolvers<Response>()
    let signal: AbortSignal | null | undefined
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_path, options) => {
      signal = options?.signal
      signal?.addEventListener("abort", () => native.reject(signal?.reason), {
        once: true
      })
      entered.resolve()
      return native.promise
    })
    const controller = new AbortController()
    const result = Effect.runPromiseExit(http.client.describe(), {
      signal: controller.signal
    })
    try {
      await entered.promise
      controller.abort()
      const exit = await result
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(signal?.aborted).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      controller.abort()
      native.resolve(new Response("{}"))
      await result
    }
  })

  it("aborts body after headers and publishes no late result", async () => {
    const pending = pendingBody()
    const controller = new AbortController()
    const rendered: unknown[] = []
    const result = Effect.runPromiseExit(
      http.client
        .describe()
        .pipe(Effect.tap((value) => Effect.sync(() => rendered.push(value)))),
      { signal: controller.signal }
    )
    try {
      await pending.entered
      controller.abort()
      const exit = await result
      await pending.completed
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(pending.signal()?.aborted).toBe(true)
      expect(pending.fetch).toHaveBeenCalledTimes(1)
      expect(rendered).toEqual([])
    } finally {
      controller.abort()
      pending.finish()
      await result
    }
  })

  it("ignores even a native body completion delivered after interruption", async () => {
    const pending = pendingBody(false)
    const controller = new AbortController()
    const rendered: unknown[] = []
    const result = Effect.runPromiseExit(
      http.client
        .describe()
        .pipe(Effect.tap((value) => Effect.sync(() => rendered.push(value)))),
      { signal: controller.signal }
    )
    try {
      await pending.entered
      controller.abort()
      await result
      expect(pending.signal()?.aborted).toBe(true)
    } finally {
      controller.abort()
      pending.finish()
      await pending.completed
      await result
    }
    expect(rendered).toEqual([])
  })

  it("keeps the eight second timeout across the body and aborts it", async () => {
    const pending = pendingBody()
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(http.client.describe())
          yield* Effect.promise(() => pending.entered)
          yield* TestClock.adjust(7_999)
          expect(pending.signal()?.aborted).toBe(false)
          yield* TestClock.adjust(1)
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(exit.cause.reasons).toMatchObject([
              { _tag: "Fail", error: { _tag: "PlaygroundError", code: "unavailable" } }
            ])
          }
          expect(pending.signal()?.aborted).toBe(true)
        }).pipe(Effect.provide(TestClock.layer()))
      )
    } finally {
      pending.finish()
      await pending.completed
    }
    expect(pending.fetch).toHaveBeenCalledTimes(1)
  })

  it("decodes success and retains same-origin POST and CSRF", async () => {
    vi.stubGlobal("document", {
      cookie: `other=value; ${http.csrfCookieName}=synthetic-csrf`
    })
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(Fixtures.sandbox))
    expect(await Effect.runPromise(http.client.describe())).toEqual(Fixtures.sandbox)
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/sandbox", {
      method: "POST",
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
      headers: {
        "Content-Type": "application/json",
        "X-Playground-CSRF": "synthetic-csrf"
      }
    })
  })

  it.each([
    [new Response("{"), "unavailable"],
    [Response.json({ ...Fixtures.sandbox, extra: true }), "unavailable"],
    [Response.json({ code: "stale-generation" }, { status: 409 }), "stale-generation"],
    [Response.json({ code: "raw-provider-diagnostic" }, { status: 503 }), "unavailable"]
  ])(
    "maps JSON/schema/HTTP failures to the existing bounded channel",
    async (response, code) => {
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response)
      const error = await Effect.runPromise(Effect.flip(http.client.describe()))
      expect(error).toMatchObject({ _tag: "PlaygroundError", code })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it("maps native fetch rejection without retry", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("synthetic offline"))
    const error = await Effect.runPromise(Effect.flip(http.client.describe()))
    expect(error).toMatchObject({ _tag: "PlaygroundError", code: "unavailable" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
