// @effect-diagnostics unstableApiUsage:off
// Honest orchestration unit fixture. Native platform/PG proof stays in the
// explicit real application gate; only external SQL/authority/storage are mocked.
import type { SqlClient as SqlClientType } from "effect/sql/SqlClient"
import type { Application as ApplicationType } from "../../src/server/Services.js"
import { vi } from "vitest"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { fromDurableObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState"
import { fromWebSocket } from "@alchemy.run/cloudflare/Workers/WebSocket"
import type * as Workers from "@cloudflare/workers-types"
import { RuntimeContext } from "alchemy/RuntimeContext"
import type { CallbackFactory } from "alchemy/Callback"
import { ConfigProvider, Effect, Scope } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Live from "../../src/live/SandboxLive.js"

const controls = vi.hoisted(() => ({ current: true, expiresAt: 0, authorizations: 0 }))
vi.mock("../../src/execution/Event.js", async () => {
  const { Effect, Layer } = await import("effect")
  const { SqlClient } = await import("effect/sql/SqlClient")
  const { Application } = await import("../../src/server/Services.js")
  const Fixtures = await import("@effect-jobs/playground-contracts/Fixtures")
  // SQL's callable surface is intentionally absent: unexpected queries fail.
  const sql = new Proxy(
    () => {
      throw new Error("unexpected SQL")
    },
    {
      get: (_target, key) => {
        if (key === "unsafe") {
          return () =>
            Effect.succeed(
              controls.current ? [{ sandbox_id: Fixtures.sandbox.ref.sandboxId }] : []
            )
        }
        throw new Error("unexpected SQL operation")
      }
    }
  ) as unknown as SqlClientType
  const { LocalPrivate } = await import("../../src/persistence/authority/PrivateMode.js")
  const { Repairs } = await import("@effect-jobs/playground-contracts/Repairs")
  const layer = Layer.mergeAll(
    Layer.succeed(LocalPrivate, true),
    Layer.succeed(SqlClient, sql),
    Layer.mock(Application, {
      repairs: Effect.runSync(
        Effect.service(Repairs).pipe(Effect.provide(Layer.mock(Repairs, {})))
      ),
      authenticate: () =>
        Effect.sync(() => {
          controls.authorizations++
          return { sandbox: { ...Fixtures.sandbox, expiresAt: controls.expiresAt } }
        })
    })
  )
  return {
    run: <A, E>(
      _config: unknown,
      _kick: unknown,
      operation: Effect.Effect<A, E, SqlClientType | ApplicationType>
    ) => operation.pipe(Effect.provide(layer))
  }
})

export const setupLive = async (options: {
  readonly now: number
  readonly pending?: boolean
  readonly sentAt?: number
  readonly expiresAt?: number
  readonly sequence?: number
  readonly current?: boolean
  readonly alarm?: number | null
  readonly origin?: string
  readonly localPreview?: boolean
  readonly viewers?: boolean
}) => {
  vi.spyOn(Date, "now").mockReturnValue(options.now)
  controls.current = options.current ?? true
  controls.expiresAt = options.expiresAt ?? options.now + 60000
  controls.authorizations = 0
  let attachment: unknown = {
    sandbox: Fixtures.sandbox.ref,
    expiresAt: controls.expiresAt,
    sequence: options.sequence ?? 1,
    sentAt: options.sentAt ?? options.now,
    pending: options.pending ?? false
  }
  const events: string[] = []
  const messages: string[] = []
  const closes: number[] = []
  let alarm = options.alarm ?? null
  let callback: Effect.Effect<void> | undefined
  const rawSocket = {
    readyState: 1,
    send: (message: string) => {
      events.push("send")
      messages.push(message)
    },
    close: (code: number) => {
      closes.push(code)
    },
    serializeAttachment: (value: unknown) => {
      attachment = value
    },
    deserializeAttachment: () => attachment
  }
  const values = new Map<string, unknown>([
    ["scope", Fixtures.sandbox.ref],
    ["dirty", true]
  ])
  const rawStorage = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      if (key === "dirty") {
        events.push(`${key}:${String(value)}`)
      }
      values.set(key, value)
    },
    delete: async (key: string) => values.delete(key),
    transaction: async <A>(body: (storage: unknown) => Promise<A>) => body(rawStorage),
    sql: {}
  }
  // Partial native FFI objects are confined to this unit fixture. The released
  // adapters own Effect and attachment conversion; this is not a DO emulator.
  const state = fromDurableObjectState({
    storage: rawStorage,
    blockConcurrencyWhile: <A>(body: () => Promise<A>) => body(),
    getWebSockets: () => (options.viewers === false ? [] : [rawSocket])
  } as unknown as Workers.DurableObjectState)
  const makeCallback: CallbackFactory = (_name, handler) =>
    Effect.gen(function* () {
      const context =
        yield* Effect.context<
          Exclude<Effect.Services<ReturnType<typeof handler>>, Scope.Scope>
        >()
      callback = handler(null as never).pipe(
        Effect.scoped,
        Effect.provide(context),
        Effect.asVoid,
        Effect.orDie
      )
      return {
        schedule: (_id, request) =>
          Effect.sync(() => {
            alarm = Number(request.at)
          }),
        cancel: () =>
          Effect.sync(() => {
            alarm = null
          }),
        getStatus: () =>
          Effect.sync(() =>
            alarm === null
              ? undefined
              : {
                  scheduledAt: alarm,
                  attempts: 0,
                  parked: false,
                  progress: undefined,
                  retryAt: undefined
                }
          )
      }
    })
  const runtime = RuntimeContext.of({
    Type: "unit",
    id: "unit",
    env: {},
    get: () => Effect.undefined,
    set: (id) => Effect.succeed(id),
    makeCallback
  })
  const provider = ConfigProvider.fromUnknown({
    PG_connectionString: "postgres://unit:unit@127.0.0.1:1/unit",
    SCHEMA: "unit",
    ORIGIN: options.origin ?? "https://example.test",
    LOCAL_PREVIEW: options.localPreview ? "true" : "false",
    ENCRYPTION_KEY: "a".repeat(64),
    FINGERPRINT_KEY: "b".repeat(64),
    CURSOR_KEY: "c".repeat(64)
  })
  const run = <A, E>(
    effect: Effect.Effect<A, E, RuntimeContext | Cloudflare.DurableObjectState>
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(RuntimeContext, runtime),
        Effect.provideService(Cloudflare.DurableObjectState, state)
      )
    )
  const initialize = await Effect.runPromise(
    Live.implementation.pipe(
      Effect.provideService(Cloudflare.DurableObjectState, state),
      Effect.provideService(ConfigProvider.ConfigProvider, provider)
    )
  )
  const object = await run(initialize)
  const alarmPass = () => {
    if (!callback) {
      throw new Error("live callback was not registered")
    }
    // Its generic services were fixed by initialize above. Invocation remains a
    // unit boundary, explicitly separate from native callback dispatch proof.
    alarm = null
    return Effect.runPromise(callback)
  }
  return {
    object,
    run,
    alarmPass,
    socket: fromWebSocket(rawSocket as unknown as Workers.WebSocket),
    events,
    messages,
    closes,
    storage: values,
    alarm: () => alarm
  }
}

export { controls }
