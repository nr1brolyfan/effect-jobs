// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Application } from "../../src/server/Services.js"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as OriginPolicy from "../../src/OriginPolicy.js"
import * as Upgrade from "../../src/server/live/Upgrade.js"
import * as Live from "../../../playground-worker/src/live/SandboxLive.js"
import * as DemoHttp from "../../../playground-worker/src/demo/Http.js"
import type { Env } from "../../../playground-worker/src/Worker.js"

const aliases = ["http://localhost:8787", "http://127.0.0.1:8787"]
const policy = OriginPolicy.make({ configuredOrigin: aliases[1]!, localPreview: true })
const request = (origin: string, supplied: string | null, method = "GET") =>
  new Request(`${origin}/api/changes`, {
    method,
    headers: { Upgrade: "websocket", ...(supplied === null ? {} : { Origin: supplied }) }
  })
const invalid = [
  [aliases[0]!, aliases[1]!],
  [aliases[1]!, aliases[0]!],
  [aliases[0]!, null],
  ["http://localhost:8788", "http://localhost:8788"],
  ["http://evil.test:8787", "http://evil.test:8787"],
  ["http://localhost.evil.test:8787", "http://localhost.evil.test:8787"],
  ["http://[::1]:8787", "http://[::1]:8787"]
] as const

const DeniedDemoLayer = Layer.mergeAll(
  Layer.mock(Application, {}),
  Layer.succeed(
    SqlClient,
    new Proxy(
      (() => {
        throw new Error("rejected request accessed SQL")
      }) as unknown as SqlClient,
      {
        get: () => {
          throw new Error("rejected request accessed SQL")
        }
      }
    )
  )
)
const runDeniedDemo = (
  incoming: Request,
  env: Env & { readonly LOCAL_PREVIEW: string }
) =>
  Effect.runPromise(DemoHttp.handle(incoming, env).pipe(Effect.provide(DeniedDemoLayer)))

describe("WebSocket admission", () => {
  it("ignores forged Host/forwarded headers and preserves hosted-only string callers", async () => {
    const spoofed = request("http://evil.test:8787", aliases[0]!)
    spoofed.headers.set("Host", "localhost:8787")
    spoofed.headers.set("X-Forwarded-Host", "localhost:8787")
    spoofed.headers.set("X-Forwarded-Proto", "http")
    const namespace = {
      getByName: () => ({ fetch: async () => Response.json({ admitted: true }) })
    }
    const authorize = () => Effect.succeed(Fixtures.sandbox)
    expect(
      (await Effect.runPromise(Upgrade.upgrade(spoofed, policy, namespace, authorize)))
        .status
    ).toBe(400)
    expect(
      (
        await Effect.runPromise(
          Upgrade.upgrade(
            request(aliases[0]!, aliases[0]!),
            aliases[0]!,
            namespace,
            authorize
          )
        )
      ).status
    ).toBe(400)
    const hosted = "https://example.test"
    expect(
      (
        await Effect.runPromise(
          Upgrade.upgrade(request(hosted, hosted), hosted, namespace, authorize)
        )
      ).status
    ).toBe(200)
    expect(
      (
        await Effect.runPromise(
          Upgrade.upgrade(
            request("https://evil.test", hosted),
            hosted,
            namespace,
            authorize
          )
        )
      ).status
    ).toBe(400)
  })
  it("interrupts in-flight authorization without routing or manufacturing a 503", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        let routes = 0
        const fiber = yield* Effect.forkChild(
          Upgrade.upgrade(
            request(aliases[0]!, aliases[0]!),
            policy,
            {
              getByName: () => {
                routes++
                throw new Error("must not route")
              }
            },
            () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
          )
        )
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        const result = yield* Fiber.await(fiber)
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(Cause.hasInterrupts(result.cause)).toBe(true)
        }
        expect(routes).toBe(0)
      })
    )
  })
  it.each(aliases)(
    "forwards actual %s unchanged through authorization and DO routing",
    async (origin) => {
      const incoming = request(origin, origin)
      let authorized = 0
      let routed = 0
      const response = await Effect.runPromise(
        Upgrade.upgrade(
          incoming,
          policy,
          {
            getByName: () => ({
              fetch: async (forwarded) => {
                routed++
                expect(forwarded).toBe(incoming)
                expect(new URL(forwarded.url).origin).toBe(origin)
                return Response.json({ admitted: true })
              }
            })
          },
          (forwarded) => {
            authorized++
            expect(forwarded).toBe(incoming)
            return Effect.succeed(Fixtures.sandbox)
          }
        )
      )
      expect(response.status).toBe(200)
      expect([authorized, routed]).toEqual([1, 1])
    }
  )

  it.each(invalid)(
    "rejects %s carrying %s before authority",
    async (origin, supplied) => {
      let calls = 0
      const response = await Effect.runPromise(
        Upgrade.upgrade(
          request(origin, supplied),
          policy,
          {
            getByName: () => {
              calls++
              throw new Error("must not route")
            }
          },
          () => {
            calls++
            return Effect.succeed(Fixtures.sandbox)
          }
        )
      )
      expect(response.status).toBe(400)
      expect(calls).toBe(0)
    }
  )

  it("rejects POST and absent Upgrade before authority", async () => {
    for (const incoming of [
      request(aliases[0]!, aliases[0]!, "POST"),
      new Request(`${aliases[0]}/api/changes`, { headers: { Origin: aliases[0]! } })
    ]) {
      const response = await Effect.runPromise(
        Upgrade.upgrade(
          incoming,
          policy,
          {
            getByName: () => {
              throw new Error("must not route")
            }
          },
          () => Effect.die("must not authorize")
        )
      )
      expect(response.status).toBe(400)
    }
  })

  it.each([
    Cause.interrupt(123),
    Cause.combine(
      Cause.fail(new PlaygroundError({ code: "unavailable" })),
      Cause.interrupt(123)
    )
  ])("preserves interruption including mixed Cause", async (cause) => {
    const result = await Effect.runPromiseExit(
      Upgrade.upgrade(
        request(aliases[0]!, aliases[0]!),
        policy,
        {
          getByName: () => {
            throw new Error("must not route")
          }
        },
        () => Effect.failCause(cause)
      )
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons).toEqual(cause.reasons)
    }
  })

  it("sanitizes authority/transport failures without exposing cause", async () => {
    for (const authorize of [
      () => Effect.fail(new PlaygroundError({ code: "not-found" })),
      () => Effect.die("private provider data"),
      () => Effect.succeed(Fixtures.sandbox)
    ]) {
      const response = await Effect.runPromise(
        Upgrade.upgrade(
          request(aliases[0]!, aliases[0]!),
          policy,
          {
            getByName: () => ({
              fetch: async () => {
                throw new Error("private transport data")
              }
            })
          },
          authorize
        )
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ code: "unavailable" })
    }
  })
})

const state = (): Live.LiveState => ({
  storage: {
    get: async () => undefined,
    put: async () => undefined,
    getAlarm: async () => null,
    setAlarm: async () => undefined,
    deleteAlarm: async () => undefined
  },
  blockConcurrencyWhile: (callback) => callback(),
  acceptWebSocket: () => undefined,
  getWebSockets: () => []
})

it("DO independently repeats exact origin admission, default hosted denial, and expiry", async () => {
  for (const localPreview of [false, true]) {
    let calls = 0
    const Durable = Live.makeDurableObject(
      {
        origin: () => aliases[1]!,
        localPreview: () => localPreview,
        authorize: () => {
          calls++
          return Effect.succeed({ ...Fixtures.sandbox, expiresAt: 1 })
        },
        isCurrent: () => Effect.succeed(true)
      },
      class {
        constructor(_ctx: Live.LiveState, _env: object) {}
      }
    )
    const object = new Durable(state(), {})
    for (const [origin, supplied] of invalid) {
      expect((await object.fetch(request(origin, supplied))).status).toBe(400)
    }
    expect(calls).toBe(0)
    for (const origin of aliases) {
      expect((await object.fetch(request(origin, origin))).status).toBe(
        localPreview ? 403 : 400
      )
    }
    expect(calls).toBe(localPreview ? 2 : 0)
  }
})

it("demo denies every mutation and foreign host before DB/services", async () => {
  // Only the pre-admission fields are exercised; unrelated native bindings must
  // never be accessed by these rejected requests.
  const env = { ORIGIN: aliases[1]!, LOCAL_PREVIEW: "true" } as Env & {
    readonly LOCAL_PREVIEW: string
  }
  for (const origin of aliases) {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await runDeniedDemo(
        new Request(`${origin}/api/demo/jobs/operator`, { method }),
        env
      )
      expect(response.status).toBe(400)
    }
  }
  for (const origin of [
    "http://localhost:8788",
    "http://evil.test:8787",
    "http://[::1]:8787"
  ]) {
    expect((await runDeniedDemo(new Request(`${origin}/api/demo`), env)).status).toBe(400)
  }
})

it("demo preview requires the exact true string", async () => {
  for (const flag of ["false", "TRUE", "1", ""]) {
    const env = { ORIGIN: aliases[1]!, LOCAL_PREVIEW: flag } as Env & {
      readonly LOCAL_PREVIEW: string
    }
    for (const origin of aliases) {
      expect((await runDeniedDemo(new Request(`${origin}/api/demo`), env)).status).toBe(
        400
      )
    }
  }
})
