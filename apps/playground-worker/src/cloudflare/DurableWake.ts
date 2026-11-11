import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import type { Callback } from "alchemy/Callback"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Cause, Effect, Exit } from "effect"
import { WakeAlarm, WakeUnavailable } from "./WakeCycle.js"

// One callback ID owns the alarm. SQLite scheduling and PG commits are distinct;
// failed/interrupted passes retain Alchemy's finite retry/parking budget.
export const make = <E>(
  name: string,
  run: (alarm: WakeAlarm["Service"]) => Effect.Effect<void, E, RuntimeContext>
) =>
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    const runtime = yield* RuntimeContext
    const local = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) =>
      effect.pipe(Effect.provideService(RuntimeContext, runtime))
    const callback: Callback<null> = yield* Alchemy.makeCallback(
      name,
      () =>
        Effect.gen(function* () {
          // Return Exit through the native gate so a domain failure does not reset
          // the object before Alchemy can persist its bounded retry/parking state.
          const result = yield* state.blockConcurrencyWhile(() =>
            Effect.gen(function* () {
              yield* run(alarm)
              // Only a completed bounded pass advances durable application progress.
              // The checkpoint and its replacement wake share a SQLite transaction;
              // neither is atomic with a PostgreSQL commit.
              yield* state.storage.transaction(
                Effect.gen(function* () {
                  const at = yield* state.storage.get<number>(`${name}:wake`)
                  const completed =
                    (yield* state.storage.get<number>(`${name}:completed`)) ?? 0
                  if (!Number.isSafeInteger(completed + 1)) {
                    return yield* Effect.die("Wake checkpoint exhausted")
                  }
                  yield* state.storage.put(`${name}:completed`, completed + 1)
                  if (at !== undefined) {
                    yield* callback.schedule("wake", {
                      at,
                      payload: null,
                      progress: completed + 1
                    })
                  }
                })
              )
            }).pipe(Effect.exit)
          )
          if (Exit.isFailure(result)) {
            // The native host logs failures. Preserve cancellation without exposing
            // provider SQL, credentials or arbitrary internal Causes to that sink.
            return yield* Cause.hasInterrupts(result.cause)
              ? Effect.interrupt
              : Effect.fail(new WakeUnavailable())
          }
        }),
      { retry: { delay: "1 second", maxAttempts: 8, parkedDelay: "1 hour" } }
    )
    const set = (at: number) =>
      local(
        state.storage.transaction(
          Effect.gen(function* () {
            yield* state.storage.put(`${name}:wake`, at)
            yield* callback.schedule("wake", { at, payload: null })
          })
        )
      ).pipe(Effect.mapError(() => new WakeUnavailable()))
    const clear = local(
      state.storage.transaction(
        Effect.gen(function* () {
          yield* state.storage.delete(`${name}:wake`)
          yield* callback.cancel("wake")
        })
      )
    ).pipe(
      Effect.asVoid,
      Effect.mapError(() => new WakeUnavailable())
    )
    const alarm = WakeAlarm.of({ set, clear })
    const earlier = (at: number) =>
      local(
        state.storage.transaction(
          Effect.gen(function* () {
            const previous = yield* callback.getStatus("wake")
            if (previous === undefined || previous.scheduledAt > at) {
              yield* set(at)
            }
          })
        )
      ).pipe(Effect.mapError(() => new WakeUnavailable()))
    return { ...alarm, earlier }
  })
