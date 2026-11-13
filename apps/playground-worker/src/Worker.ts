import * as Definitions from "./scenarios/Definitions.js"
import type * as Workers from "@cloudflare/workers-types"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import {
  Clock,
  Config,
  Effect,
  Scheduler,
  Schema,
  SchemaGetter,
  SchemaParser
} from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpRequest from "effect/http/HttpServerRequest"
import * as HttpResponse from "effect/http/HttpServerResponse"
// @effect-diagnostics unstableApiUsage:off
import { SqlClient } from "effect/sql/SqlClient"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as RepairShowcase from "./demo/RepairShowcase.js"
import * as OriginPolicy from "./OriginPolicy.js"
import * as Event from "./execution/Event.js"
import * as Executor from "./execution/Executor.js"
import { WakeAlarm } from "./cloudflare/WakeCycle.js"
import * as DurableWake from "./cloudflare/DurableWake.js"
import * as Configuration from "./cloudflare/Configuration.js"
import { SandboxLive } from "./live/SandboxLive.js"
import * as Http from "./server/HttpApplication.js"
import * as PostCommit from "./server/live/PostCommit.js"
import { objectName } from "./server/live/PostCommit.js"
import { Application } from "./server/Services.js"
import * as Upgrade from "./server/live/Upgrade.js"
import * as Demo from "./demo/Manager.js"
import * as DemoHttp from "./demo/Http.js"

export { SandboxLive }
// Kept for the existing demo transport's configuration-only input. Platform
// namespaces themselves are native typed dependencies, resolved during init.
export type Env = Configuration.Configuration & {
  readonly LIVE: PostCommit.LiveNamespace
}
const WakeScopeRow = Schema.Struct({
  sandbox_id: Schema.Unknown.pipe(Schema.optionalKey),
  generation: Schema.Unknown.pipe(Schema.optionalKey)
}).pipe(
  Schema.decodeTo(Schema.toType(SandboxRef), {
    decode: SchemaGetter.transformEffect((row) =>
      SchemaParser.decodeUnknownEffect(SandboxRef)({
        sandboxId: row.sandbox_id,
        generation: Number(row.generation)
      })
    ),
    encode: SchemaGetter.forbiddenEncoding
  })
)
const yieldRef = Schema.decodeUnknownSync(WakeScopeRow)
const safe = <E, R>(effect: Effect.Effect<Response, E, R>) =>
  effect.pipe(
    Effect.timeout("8 seconds"),
    Effect.catchCause(() => Effect.succeed(Http.response({ code: "unavailable" }, 503)))
  )

const queue = (name: Executor.QueueName) =>
  Effect.gen(function* () {
    const definitions = yield* Definitions.make.pipe(Effect.orDie)

    const state = yield* Cloudflare.DurableObjectState
    const env = yield* Configuration.configuration
    const live = yield* SandboxLive
    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext
      const storage = state.storage
      const wake = yield* DurableWake.make("queue", (alarm) =>
        Effect.gen(function* () {
          const reconcile = Effect.gen(function* () {
            const sql = yield* SqlClient
            const rows = yield* sql.unsafe<{
              sandbox_id: string
              generation: string
              signature: string
            }>(
              `WITH viewers AS MATERIALIZED (
            SELECT sandbox_id,generation FROM "${env.SCHEMA}"."sandboxes"
            WHERE viewer_until>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
              AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
            ORDER BY sandbox_id LIMIT 100
          ) SELECT v.sandbox_id,v.generation,
            count(j.id)::text || ':' || coalesce(sum(j.lifecycle_version),0)::text AS signature
          FROM viewers v LEFT JOIN "${env.SCHEMA}"."associations" a
            ON a.sandbox_id=v.sandbox_id AND a.generation=v.generation
          LEFT JOIN "${env.SCHEMA}"."jobs" j ON j.id=a.job_id
          GROUP BY v.sandbox_id,v.generation ORDER BY v.sandbox_id`
            )
            // No terminal deletion exists: count + monotone lifecycle versions detect
            // changes without payload reads. Persist a bounded hint cache, not authority.
            const previous = yield* storage.get<Record<string, string>>("hints")
            const current = Object.fromEntries(
              rows.map((row) => [objectName(yieldRef(row)), row.signature])
            )
            yield* Effect.forEach(
              rows.filter(
                (row) => previous?.[objectName(yieldRef(row))] !== row.signature
              ),
              (row) =>
                Effect.gen(function* () {
                  const ref = yieldRef(row)
                  yield* live.getByName(objectName(ref)).notifyCommitted(ref)
                }),
              { concurrency: 4, discard: true }
            ).pipe(Effect.timeout("1 second"), Effect.ignore)
            yield* storage.put("hints", current)
          }).pipe(Effect.ignore)

          yield* Event.run(
            Configuration.database(env),
            Effect.void,
            Executor.run(env.SCHEMA, name).pipe(
              Effect.provideService(WakeAlarm, alarm),
              Effect.provideService(Executor.ExecutionHints, {
                reconcile: reconcile.pipe(Effect.provideService(RuntimeContext, runtime))
              })
            ),
            definitions
          )
        })
      )
      return {
        activate: () =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => wake.earlier(now + 400)),
            Effect.orDie
          )
      }
    })
  })
export class Communications extends Cloudflare.DurableObject<Communications>()(
  "Communications",
  queue("playground-communications")
) {}
export class Media extends Cloudflare.DurableObject<Media>()(
  "Media",
  queue("playground-media")
) {}
export class Commerce extends Cloudflare.DurableObject<Commerce>()(
  "Commerce",
  queue("playground-commerce")
) {}
export class Private extends Cloudflare.DurableObject<Private>()(
  "Private",
  queue("playground-private")
) {}

const queueKick = Effect.gen(function* () {
  const communications = yield* Communications
  const media = yield* Media
  const commerce = yield* Commerce
  const privateQueue = yield* Private
  return Effect.suspend(() =>
    Effect.all(
      [
        communications.getByName("shared").activate(),
        media.getByName("shared").activate(),
        commerce.getByName("shared").activate(),
        privateQueue.getByName("shared").activate()
      ],
      { concurrency: "unbounded", discard: true }
    )
  ).pipe(Effect.timeout("1 second"), Effect.ignore)
})

export class Gateway extends Cloudflare.DurableObject<Gateway>()(
  "Gateway",
  Effect.gen(function* () {
    const definitions = yield* Definitions.make.pipe(Effect.orDie)

    const state = yield* Cloudflare.DurableObjectState
    const configuration = yield* Configuration.configuration
    const LIVE = yield* SandboxLive
    const kick = yield* queueKick
    const env = { ...configuration, LIVE }
    return Effect.succeed({
      fetch: Effect.gen(function* () {
        const request = yield* HttpRequest.toWeb(yield* HttpServerRequest).pipe(
          Effect.orDie
        )
        const response = yield* state
          .blockConcurrencyWhile(() =>
            Effect.gen(function* () {
              const minute = Math.floor((yield* Clock.currentTimeMillis) / 60000)
              const previous = yield* state.storage.get<{
                minute: number
                total: number
                counts: Record<string, number>
              }>("rates")
              const budget =
                previous?.minute === minute ? previous : { minute, total: 0, counts: {} }
              const admit = (key: string) => {
                if (
                  budget.total >= 600 ||
                  (budget.counts[key] ?? 0) >=
                    (key === "issue" ? 5 : key === "request" ? 600 : 120) ||
                  (budget.counts[key] === undefined &&
                    Object.keys(budget.counts).length >= 256)
                ) {
                  return false
                }
                budget.total++
                budget.counts[key] = (budget.counts[key] ?? 0) + 1
                return true
              }
              if (!admit("request")) {
                yield* state.storage.put("rates", budget)
                return Http.response({ code: "limit-reached" }, 429)
              }
              const originConfig = {
                configuredOrigin: env.ORIGIN,
                localPreview: env.LOCAL_PREVIEW === "true"
              }
              const policy = OriginPolicy.make(originConfig)
              if (policy.resolve(new URL(request.url).origin) === undefined) {
                yield* state.storage.put("rates", budget)
                return Http.response({ code: "invalid-request" }, 400)
              }
              if (
                !new URL(request.url).pathname.startsWith("/api/demo") &&
                env.LOCAL_PRIVATE !== "true"
              ) {
                return Http.response({ code: "not-found" }, 404)
              }
              const operation = new URL(request.url).pathname.startsWith("/api/demo")
                ? DemoHttp.handle(request, env)
                : new URL(request.url).pathname === "/api/changes"
                  ? Effect.gen(function* () {
                      const app = yield* Application
                      return yield* Upgrade.upgrade(request, policy, env.LIVE, (req) =>
                        Http.authenticate(req, originConfig).pipe(
                          Effect.provideService(Application, app),
                          Effect.map((access) => access.sandbox)
                        )
                      )
                    })
                  : Http.handle(request, env.ORIGIN, admit, originConfig.localPreview)
              const response = yield* safe(
                Event.run(
                  Configuration.database(env),
                  kick,
                  operation.pipe(Effect.provide(PostCommit.layer(env.LIVE))),
                  definitions
                )
              )
              yield* state.storage.put("rates", budget)
              return response
            })
          )
          .pipe(
            // A native input gate can hold timer events from another invocation.
            // Keep Effect's bounded yields on microtasks while this gate is held;
            // admission/rate state and per-call PG Scope stay serialized as before.
            Effect.provideService(
              Scheduler.Scheduler,
              new Scheduler.MixedScheduler("sync")
            )
          )
        return Upgrade.response(response)
      })
    })
  })
) {}

export class DemoGenerator extends Cloudflare.DurableObject<DemoGenerator>()(
  "DemoGenerator",
  Effect.gen(function* () {
    const definitions = yield* Definitions.make.pipe(Effect.orDie)

    const env = yield* Configuration.configuration
    const kick = yield* queueKick
    return Effect.gen(function* () {
      const wake = yield* DurableWake.make("demo", (alarm) =>
        Effect.gen(function* () {
          yield* alarm.set((yield* Clock.currentTimeMillis) + 5000)
          const rotation = Number(env.DEMO_ROTATION_MS)
          if (
            !Number.isInteger(rotation) ||
            rotation < 10_000 ||
            rotation > Demo.limits.rotationMillis
          ) {
            return yield* Effect.die("Invalid demo rotation interval")
          }
          const result = yield* Event.run(
            Configuration.database(env),
            Effect.void,
            Effect.gen(function* () {
              const result = yield* Demo.tick(env.SCHEMA, rotation)
              if (
                result.phase === "published" ||
                result.phase === "running" ||
                result.phase === "waiting"
              ) {
                const sandbox = yield* Demo.current(env.SCHEMA)
                yield* RepairShowcase.run(env.SCHEMA, sandbox)
              }
              return result
            }),
            definitions
          )
          yield* kick
          yield* alarm.set(
            (yield* Clock.currentTimeMillis) +
              (result.phase === "preparing" ? 1000 : 5000)
          )
        })
      )
      return {
        activate: () =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => wake.earlier(now + 100)),
            Effect.orDie
          )
      }
    })
  })
) {}

export const [properties, implementation] = [
  Effect.gen(function* () {
    const origin = yield* Config.String("ORIGIN")
    const preview = yield* Config.String("LOCAL_PREVIEW").pipe(
      Config.withDefault("false")
    )
    const directory = yield* Config.String("ASSET_DIRECTORY").pipe(
      Config.withDefault("./.alchemy/playground-assets")
    )
    return {
      main: import.meta.url,
      compatibility: { date: "2026-10-12", flags: ["nodejs_compat"] },
      // All routes pass admission before static matching. Foundation supplies the
      // final built site/dashboard directory at this explicit configuration key.
      assets: { directory, runWorkerFirst: true },
      ...(preview === "true"
        ? {
            dev: {
              host: new URL(origin).hostname,
              port: Number(new URL(origin).port),
              strictPort: true
            }
          }
        : {})
    }
  }),
  Effect.gen(function* () {
    const env = yield* Configuration.configuration
    const gateway = yield* Gateway
    const demo = yield* DemoGenerator
    // Bind every fixed queue identity even when no request has activated it yet.
    yield* Communications
    yield* Media
    yield* Commerce
    yield* Private
    yield* SandboxLive
    return {
      fetch: Effect.gen(function* () {
        const incoming = yield* HttpServerRequest
        const request = yield* HttpRequest.toWeb(incoming).pipe(Effect.orDie)
        const url = new URL(request.url)
        const policy = OriginPolicy.make({
          configuredOrigin: env.ORIGIN,
          localPreview: env.LOCAL_PREVIEW === "true"
        })
        if (policy.resolve(url.origin) === undefined) {
          return HttpResponse.fromWeb(Http.response({ code: "invalid-request" }, 400))
        }
        const demoReads = new Set([
          "/api/demo",
          "/api/demo/jobs",
          "/api/demo/jobs/detail",
          "/api/demo/jobs/problems",
          "/api/demo/jobs/history",
          "/api/demo/jobs/related",
          "/api/demo/changes"
        ])
        if (
          (url.pathname === "/api/demo" || url.pathname.startsWith("/api/demo/")) &&
          (request.method !== "GET" || !demoReads.has(url.pathname))
        ) {
          return HttpResponse.fromWeb(Http.response({ code: "not-found" }, 404))
        }
        const assets = (path: string) =>
          Effect.gen(function* () {
            if (request.method !== "GET" && request.method !== "HEAD") {
              return HttpResponse.empty({ status: 405 })
            }
            const reserved = ["/jobs", "/api", "/demo"].some(
              (prefix) =>
                path === prefix ||
                path === prefix + ".html" ||
                path.startsWith(prefix + "/")
            )
            if (reserved && path !== "/jobs" && path !== "/demo") {
              return HttpResponse.text("Not found", { status: 404 })
            }
            // Static assets expose a native Fetcher rather than an Effect binding.
            const bindings = yield* Cloudflare.WorkerEnvironment
            return yield* Effect.promise(() =>
              (bindings.ASSETS as Workers.Fetcher).fetch(
                new Request(
                  new URL(path, url).toString(),
                  request
                ) as unknown as Workers.Request
              )
            ).pipe(
              Effect.map((response) => Upgrade.response(response as unknown as Response))
            )
          })
        if (
          url.pathname === "/demo" ||
          url.pathname.startsWith("/demo/jobs/") ||
          url.pathname === "/api/demo" ||
          url.pathname.startsWith("/api/demo/")
        ) {
          return yield* Effect.gen(function* () {
            yield* demo.getByName("shared").activate()
            if (url.pathname === "/demo" || url.pathname.startsWith("/demo/jobs/")) {
              return yield* assets("/demo")
            }
            return yield* gateway.getByName("shared").fetch(incoming)
          }).pipe(
            Effect.catchCause(() =>
              Effect.succeed(
                HttpResponse.fromWeb(Http.response({ code: "unavailable" }, 503))
              )
            )
          )
        }
        if (
          (url.pathname === "/jobs" ||
            url.pathname.startsWith("/jobs/") ||
            url.pathname.startsWith("/api/")) &&
          env.LOCAL_PRIVATE !== "true"
        ) {
          return HttpResponse.fromWeb(Http.response({ code: "not-found" }, 404))
        }
        if (url.pathname.startsWith("/api/")) {
          return yield* gateway
            .getByName("shared")
            .fetch(incoming)
            .pipe(
              Effect.catchCause(() =>
                Effect.succeed(
                  HttpResponse.fromWeb(Http.response({ code: "unavailable" }, 503))
                )
              )
            )
        }
        return yield* assets(
          url.pathname.startsWith("/jobs/") ? "/jobs" : url.pathname + url.search
        )
      })
    }
  })
] as const

export default Cloudflare.Worker("Worker", properties, implementation)
