import * as OriginPolicy from "../../website/src/OriginPolicy.js"
// Cloudflare callbacks are the Promise FFI. All database work is scoped Effect.
// @effect-diagnostics unstableApiUsage:off
import { DurableObject } from "cloudflare:workers"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Event from "./execution/Event.js"
import * as Executor from "./execution/Executor.js"
import { WakeAlarm, WakeUnavailable } from "./cloudflare/WakeCycle.js"
import * as Live from "./live/SandboxLive.js"
import * as Http from "../../website/src/server/HttpApplication.js"
import * as PostCommit from "../../website/src/server/live/PostCommit.js"
import { objectName } from "../../website/src/server/live/PostCommit.js"
import { Application } from "../../website/src/server/Services.js"
import * as Upgrade from "../../website/src/server/live/Upgrade.js"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Demo from "./demo/Manager.js"
import * as DemoHttp from "./demo/Http.js"

interface Stub {
  fetch(request: Request): Promise<Response>
  activate(): Promise<void>
  notifyCommitted(ref: SandboxRef): Promise<void>
}
interface Namespace {
  getByName(name: string): Stub
}
interface State extends Live.LiveState {}
export interface Env {
  readonly PG: { readonly connectionString: string }
  readonly SCHEMA: string
  readonly ORIGIN: string
  readonly LOCAL_PREVIEW?: string
  readonly LOCAL_PRIVATE?: string
  readonly ENCRYPTION_KEY: string
  readonly FINGERPRINT_KEY: string
  readonly CURSOR_KEY: string
  readonly GATEWAY: Namespace
  readonly COMMUNICATIONS: Namespace
  readonly MEDIA: Namespace
  readonly COMMERCE: Namespace
  readonly PRIVATE: Namespace
  readonly LIVE: Namespace
  readonly DEMO: Namespace
  readonly DEMO_ROTATION_MS?: string
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
}
const config = (env: Env): Event.Config => ({
  localPrivate: env.LOCAL_PRIVATE === "true",
  connectionString: env.PG.connectionString,
  schema: env.SCHEMA,
  encryptionKey: env.ENCRYPTION_KEY,
  fingerprintKey: env.FINGERPRINT_KEY,
  cursorKey: env.CURSOR_KEY
})
const yieldRef = (row: { sandbox_id: string; generation: string }) =>
  Schema.decodeUnknownSync(SandboxRef)({
    sandboxId: row.sandbox_id,
    generation: Number(row.generation)
  })
const queues = (env: Env) => [env.COMMUNICATIONS, env.MEDIA, env.COMMERCE, env.PRIVATE]
const kick = (env: Env) =>
  Effect.tryPromise({
    try: () =>
      Promise.all(
        queues(env).map((namespace) => namespace.getByName("shared").activate())
      ),
    catch: () => undefined
  }).pipe(Effect.timeout("1 second"), Effect.ignore)
const safe = <E>(effect: Effect.Effect<Response, E>) =>
  Effect.runPromise(effect.pipe(Effect.timeout("8 seconds"))).catch(() =>
    Http.response({ code: "unavailable" }, 503)
  )

export class Gateway extends DurableObject {
  constructor(
    private readonly ctx: State,
    private readonly env: Env
  ) {
    super(ctx, env)
  }
  fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const minute = Math.floor(Date.now() / 60000)
      const previous = await this.ctx.storage.get<{
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
          (budget.counts[key] === undefined && Object.keys(budget.counts).length >= 256)
        ) {
          return false
        }
        budget.total++
        budget.counts[key] = (budget.counts[key] ?? 0) + 1
        return true
      }
      if (!admit("request")) {
        await this.ctx.storage.put("rates", budget)
        return Http.response({ code: "limit-reached" }, 429)
      }
      const env = this.env
      const originConfig = {
        configuredOrigin: env.ORIGIN,
        localPreview: env.LOCAL_PREVIEW === "true"
      }
      const policy = OriginPolicy.make(originConfig)
      if (policy.resolve(new URL(request.url).origin) === undefined) {
        await this.ctx.storage.put("rates", budget)
        return Http.response({ code: "invalid-request" }, 400)
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
      const response = await safe(
        Event.run(
          config(this.env),
          kick(this.env),
          operation.pipe(Effect.provide(PostCommit.layer(env.LIVE)))
        )
      )
      await this.ctx.storage.put("rates", budget)
      return response
    })
  }
}

class Queue extends DurableObject {
  constructor(
    private readonly ctx: State,
    private readonly env: Env,
    private readonly queue: Executor.QueueName
  ) {
    super(ctx, env)
  }
  activate(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const at = Date.now() + 400
      const previous = await this.ctx.storage.getAlarm()
      if (previous === null || previous > at) {
        await this.ctx.storage.setAlarm(at)
      }
    })
  }
  alarm(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const alarm = {
        set: (at: number) =>
          Effect.tryPromise({
            try: () => this.ctx.storage.setAlarm(at),
            catch: () => new WakeUnavailable()
          }),
        clear: Effect.tryPromise({
          try: () => this.ctx.storage.deleteAlarm(),
          catch: () => new WakeUnavailable()
        })
      }
      const env = this.env
      const storage = this.ctx.storage
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
        const previous = yield* Effect.promise(() =>
          storage.get<Record<string, string>>("hints")
        )
        const current = Object.fromEntries(
          rows.map((row) => [objectName(yieldRef(row)), row.signature])
        )
        yield* Effect.forEach(
          rows.filter((row) => previous?.[objectName(yieldRef(row))] !== row.signature),
          (row) =>
            Effect.tryPromise({
              try: () => {
                const ref = yieldRef(row)
                return env.LIVE.getByName(objectName(ref)).notifyCommitted(ref)
              },
              catch: () => undefined
            }),
          { concurrency: 4, discard: true }
        ).pipe(Effect.timeout("1 second"), Effect.ignore)
        yield* Effect.promise(() => storage.put("hints", current))
      }).pipe(Effect.ignore)
      await Effect.runPromise(
        Event.run(
          config(this.env),
          Effect.void,
          Executor.run(this.env.SCHEMA, this.queue).pipe(
            Effect.provideService(WakeAlarm, alarm),
            Effect.provideService(Executor.ExecutionHints, { reconcile })
          )
        )
      ).catch(() => {
        // Reject at the native callback boundary so finite alarm retries apply.
        // Never attach the internal Cause or PostgreSQL configuration.
        throw new Error("Queue alarm unavailable")
      })
    })
  }
}
export class Communications extends Queue {
  constructor(ctx: State, env: Env) {
    super(ctx, env, "playground-communications")
  }
}
export class Media extends Queue {
  constructor(ctx: State, env: Env) {
    super(ctx, env, "playground-media")
  }
}
export class Commerce extends Queue {
  constructor(ctx: State, env: Env) {
    super(ctx, env, "playground-commerce")
  }
}
export class Private extends Queue {
  constructor(ctx: State, env: Env) {
    super(ctx, env, "playground-private")
  }
}
export class DemoGenerator extends DurableObject {
  constructor(
    private readonly ctx: State,
    private readonly env: Env
  ) {
    super(ctx, env)
  }
  activate(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + 100)
      }
    })
  }
  alarm(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      // Prearm repairs failures/restarts without depending on page traffic.
      await this.ctx.storage.setAlarm(Date.now() + 5000)
      const rotation = Number(this.env.DEMO_ROTATION_MS ?? Demo.limits.rotationMillis)
      if (
        !Number.isInteger(rotation) ||
        rotation < 10_000 ||
        rotation > Demo.limits.rotationMillis
      ) {
        throw new Error("Invalid demo rotation interval")
      }
      const result = await Effect.runPromise(
        Event.run(config(this.env), Effect.void, Demo.tick(this.env.SCHEMA, rotation))
      )
      await Effect.runPromise(kick(this.env))
      await this.ctx.storage.setAlarm(
        Date.now() + (result.phase === "preparing" ? 1000 : 5000)
      )
    })
  }
}
export class SandboxLive extends Live.makeDurableObject<Env, State>(
  {
    origin: (env) => env.ORIGIN,
    localPreview: (env) => env.LOCAL_PREVIEW === "true",
    authorize: (request, env) =>
      Event.run(
        config(env),
        Effect.void,
        new URL(request.url).pathname === "/api/demo/changes"
          ? Demo.current(env.SCHEMA).pipe(
              Effect.mapError(() => new HttpError({ code: "unavailable" }))
            )
          : Http.authenticate(request, {
              configuredOrigin: env.ORIGIN,
              localPreview: env.LOCAL_PREVIEW === "true"
            }).pipe(Effect.map((access) => access.sandbox))
      ).pipe(Effect.mapError(() => new HttpError({ code: "unavailable" }))),
    isCurrent: (ref, env) =>
      Event.run(
        config(env),
        Effect.void,
        Effect.gen(function* () {
          const sql = yield* SqlClient
          const rows = yield* sql.unsafe(
            `SELECT sandbox_id FROM "${env.SCHEMA}"."sandboxes" WHERE sandbox_id=$1 AND generation=$2 AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint`,
            [ref.sandboxId, ref.generation]
          )
          return rows.length === 1
        })
      ).pipe(Effect.mapError(() => new HttpError({ code: "unavailable" })))
  },
  DurableObject
) {}
import { PlaygroundError as HttpError } from "@effect-jobs/playground-contracts/Services"
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const policy = OriginPolicy.make({
      configuredOrigin: env.ORIGIN,
      localPreview: env.LOCAL_PREVIEW === "true"
    })
    if (policy.resolve(url.origin) === undefined) {
      return Promise.resolve(Http.response({ code: "invalid-request" }, 400))
    }
    if (url.pathname === "/demo" || url.pathname.startsWith("/api/demo")) {
      // Native RPC cannot be invoked by an untrusted HTTP caller.
      return env.DEMO.getByName("shared")
        .activate()
        .then(() =>
          url.pathname === "/demo"
            ? env.ASSETS.fetch(request)
            : env.GATEWAY.getByName("shared").fetch(request)
        )
        .catch(() => Http.response({ code: "unavailable" }, 503))
    }
    if (url.pathname.startsWith("/api/")) {
      return env.GATEWAY.getByName("shared")
        .fetch(request)
        .catch(() => Http.response({ code: "unavailable" }, 503))
    }
    return env.ASSETS.fetch(request)
  }
}
