import * as Cloudflare from "@alchemy.run/cloudflare"
import type {
  CallbackFactory,
  CallbackStatus,
  CallbackOptions,
  CallbackError
} from "alchemy/Callback"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Effect, Exit, Schema } from "effect"

export const names = ["Communications", "Media", "Commerce", "Private"] as const
export type Observation = typeof Observation.Type
export const Observation = Schema.Struct({
  name: Schema.Literals(names),
  activations: Schema.Int,
  calls: Schema.Int,
  failures: Schema.Int,
  alarm: Schema.Number.pipe(Schema.NullOr),
  scheduledAt: Schema.Number.pipe(Schema.NullOr),
  retryAt: Schema.Number.pipe(Schema.NullOr),
  attempts: Schema.Int,
  progress: Schema.Int.pipe(Schema.NullOr),
  parked: Schema.Boolean
})
export interface ObservedQueue {
  readonly observe: () => Effect.Effect<Observation>
}

// Decorate only a test Worker's real native export. The original constructor,
// callback registration, retry policy, delivery and schedule/cancel are retained.
export const decorate = (
  name: (typeof names)[number],
  value: Cloudflare.DurableObjectExport
) => ({
  ...value,
  constructor: value.constructor.pipe(
    Effect.map((initialize) =>
      Effect.gen(function* () {
        const state = yield* Cloudflare.DurableObjectState
        const runtime = yield* RuntimeContext
        const nativeFactory = runtime.makeCallback
        if (!nativeFactory) {
          return yield* Effect.die("Native callback factory missing")
        }
        const increment = (key: string) =>
          state.storage.transaction(
            Effect.gen(function* () {
              const count = (yield* state.storage.get<number>(`fixture:${key}`)) ?? 0
              yield* state.storage.put(`fixture:${key}`, count + 1)
            })
          )
        let status:
          | (() => Effect.Effect<
              CallbackStatus | undefined,
              CallbackError,
              RuntimeContext
            >)
          | undefined
        const makeCallback: CallbackFactory = <Payload, E, R>(
          callbackName: string,
          handler: (payload: Payload) => Effect.Effect<unknown, E, R>,
          options?: CallbackOptions
        ) =>
          nativeFactory(
            callbackName,
            (payload: Payload) =>
              Effect.andThen(increment("calls"), handler(payload)).pipe(
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) ? increment("failures") : Effect.void
                )
              ),
            options
          ).pipe(
            Effect.tap((callback) =>
              Effect.sync(() => {
                if (callbackName === "queue") {
                  status = () => callback.getStatus("wake")
                }
              })
            )
          )
        const shape = yield* initialize.pipe(
          Effect.provideService(RuntimeContext, { ...runtime, makeCallback })
        )
        // Native DurableObjectExport deliberately erases non-handler RPC shapes.
        // This fixture decorates only the four known production queue exports.
        const queue = shape as typeof shape & {
          readonly activate: () => Effect.Effect<void>
        }
        return {
          ...shape,
          activate: () =>
            queue.activate().pipe(Effect.andThen(increment("activations")), Effect.orDie),
          observe: () =>
            state
              .blockConcurrencyWhile(() =>
                Effect.gen(function* () {
                  if (!status) {
                    return yield* Effect.die("Queue callback was not registered")
                  }
                  const current = yield* status().pipe(Effect.orDie)
                  return {
                    name,
                    activations:
                      (yield* state.storage.get<number>("fixture:activations")) ?? 0,
                    calls: (yield* state.storage.get<number>("fixture:calls")) ?? 0,
                    failures: (yield* state.storage.get<number>("fixture:failures")) ?? 0,
                    alarm: yield* state.storage.getAlarm(),
                    scheduledAt: current?.scheduledAt ?? null,
                    retryAt: current?.retryAt ?? null,
                    attempts: current?.attempts ?? 0,
                    progress: current?.progress ?? null,
                    parked: current?.parked ?? false
                  } satisfies Observation
                })
              )
              .pipe(Effect.provideService(RuntimeContext, runtime))
        }
      })
    )
  )
})
