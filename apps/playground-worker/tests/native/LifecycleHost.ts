import * as Cloudflare from "@alchemy.run/cloudflare"
import { Clock, Effect } from "effect"
import type { CallbackError, CallbackFactory } from "alchemy/Callback"
import { RuntimeContext } from "alchemy/RuntimeContext"
import * as HttpRequest from "effect/http/HttpServerRequest"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as Response from "effect/http/HttpServerResponse"
// @effect-diagnostics unstableApiUsage:off
import { SqlClient } from "effect/sql/SqlClient"
import * as Configuration from "../../src/cloudflare/Configuration.js"
import * as Event from "../../src/execution/Event.js"
import * as Live from "../../src/live/SandboxLive.js"
import * as DurableWake from "../../src/cloudflare/DurableWake.js"

// Only this fixture exposes diagnostics. It executes the exact production
// Event.run and DurableWake modules inside native workerd, with real PG.
class WakeProbe extends Cloudflare.DurableObject<WakeProbe>()(
  "WakeProbe",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext
      const wake = yield* DurableWake.make("probe", (alarm) =>
        Effect.gen(function* () {
          const passes = (yield* state.storage.get<number>("passes")) ?? 0
          yield* state.storage.put("passes", passes + 1)
          if (passes + 1 < 12) {
            yield* alarm.set((yield* Clock.currentTimeMillis) + 50)
          } else {
            yield* alarm.clear
          }
        })
      )
      return {
        start: () => wake.earlier(Date.now() + 50).pipe(Effect.orDie),
        passes: () =>
          state.storage
            .get<number>("passes")
            .pipe(Effect.provideService(RuntimeContext, runtime))
      }
    })
  })
) {}
class FailureProbe extends Cloudflare.DurableObject<FailureProbe>()(
  "FailureProbe",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext
      const wake = yield* DurableWake.make("failure", () =>
        Effect.gen(function* () {
          const attempts = (yield* state.storage.get<number>("attempts")) ?? 0
          yield* state.storage.put("attempts", attempts + 1)
          return yield* Effect.die(new Error("native-sensitive-marker"))
        })
      )
      return {
        start: () => wake.earlier(Date.now() + 50).pipe(Effect.orDie),
        cancel: () => wake.clear.pipe(Effect.orDie),
        attempts: () =>
          state.storage
            .get<number>("attempts")
            .pipe(Effect.provideService(RuntimeContext, runtime))
      }
    })
  })
) {}
class ApplicationLiveProbe extends Cloudflare.DurableObject<ApplicationLiveProbe>()(
  "ApplicationLiveProbe",
  Effect.gen(function* () {
    const initialize = yield* Live.implementation
    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext
      const nativeFactory = runtime.makeCallback
      if (nativeFactory === undefined) {
        return yield* Effect.die("Native callback factory missing")
      }
      const cancellation = new Map<
        string,
        Effect.Effect<void, CallbackError, RuntimeContext>
      >()
      // Capture the real handle without replacing its registration or delivery.
      // This fixture alone can cancel maintenance to create a genuine idle window.
      const makeCallback: CallbackFactory = (name, handler, options) =>
        nativeFactory(name, handler, options).pipe(
          Effect.tap((callback) =>
            Effect.sync(() => {
              cancellation.set(name, callback.cancel("wake"))
            })
          )
        )
      const shape = yield* initialize.pipe(
        Effect.provideService(RuntimeContext, { ...runtime, makeCallback })
      )
      const activation = crypto.randomUUID()
      return {
        ...shape,
        activation: () => Effect.succeed(activation),
        pause: () =>
          Effect.suspend(
            () => cancellation.get("live") ?? Effect.die("Live callback handle missing")
          ).pipe(Effect.provideService(RuntimeContext, runtime))
      }
    })
  })
) {}
export default Cloudflare.Worker(
  "LifecycleHost",
  { main: import.meta.url, dev: { port: 0 } },
  Effect.gen(function* () {
    const env = yield* Configuration.configuration
    const probes = yield* WakeProbe
    const lives = yield* ApplicationLiveProbe
    const failures = yield* FailureProbe
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const path = new URL(request.url, "http://local").pathname
        if (path === "/failure/start") {
          yield* failures.getByName("owned").start()
          return Response.empty()
        }
        if (path === "/failure/cancel") {
          yield* failures.getByName("owned").cancel()
          return Response.empty()
        }
        if (path === "/failure/attempts") {
          return Response.text(String(yield* failures.getByName("owned").attempts()))
        }
        if (path === "/probe/socket") {
          const raw = yield* HttpRequest.toWeb(request).pipe(Effect.orDie)
          return yield* lives
            .getByName("owned")
            .fetch(HttpRequest.fromWeb(new Request(env.ORIGIN + "/api/changes", raw)))
        }
        if (path === "/probe/pause") {
          yield* lives.getByName("owned").pause().pipe(Effect.orDie)
          return Response.empty()
        }
        if (path === "/probe/activation") {
          return Response.text(yield* lives.getByName("owned").activation())
        }
        if (path === "/wake/start") {
          yield* probes.getByName("owned").start()
          return Response.text("started")
        }
        if (path === "/wake/passes") {
          return Response.text(String(yield* probes.getByName("owned").passes()))
        }
        const url = new URL(env.PG.connectionString)
        url.searchParams.set("application_name", "native-lifecycle-probe")
        const result = yield* Event.run(
          { ...Configuration.database(env), connectionString: url.toString() },
          Effect.void,
          Effect.gen(function* () {
            const sql = yield* SqlClient
            yield* sql.unsafe(
              path === "/interruption" ? "SELECT pg_sleep(60)" : "SELECT 1"
            )
            if (path === "/defect") {
              return yield* Effect.die("synthetic lifecycle defect")
            }
          }).pipe(Effect.timeout("150 millis"))
        ).pipe(
          Effect.matchCause({
            onFailure: () => "closed-failure",
            onSuccess: () => "closed-success"
          })
        )
        return Response.text(result)
      })
    }
  })
)
