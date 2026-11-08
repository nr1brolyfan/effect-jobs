import * as Alchemy from "alchemy/Callback"
import { Effect, Schema } from "effect"
import type { Observation } from "effect-jobs/JobSchedule"
import type { DrainResult } from "effect-jobs/JobWorker"

export const repairMillis = 60_000
// Uses a database-relative delay. Null/saturated/Idle never cancels the repair path.
export const nextDelay = (result: DrainResult, hint: Observation) => {
  if (result._tag === "Backoff") {
    return repairMillis
  }
  if (result._tag === "MoreWork" || hint.saturated) {
    return 1000
  }
  const deadlines = [hint.nextAvailableAt, hint.nextRecoveryAt].filter(
    (time) => time !== null
  )
  return Math.min(
    repairMillis,
    ...deadlines.map((time) => Math.max(1000, time - hint.observedAt))
  )
}

// The ID is constant: at most one pending wake row, including same-ID replacement.
export const makeWake = <E, R>(
  run: Effect.Effect<{ result: DrainResult; hint: Observation }, E, R>
) =>
  Effect.gen(function* () {
    const callback: Alchemy.Callback<null> = yield* Alchemy.makeCallback(
      "billing-drain",
      (_payload: null) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(Schema.Null)(_payload)
          // Durable prearm BEFORE any SQL/external execution. Replacement survives old-version ack.
          yield* callback.schedule("billing", { after: repairMillis, payload: null })
          const value = yield* run
          yield* callback.schedule("billing", {
            after: nextDelay(value.result, value.hint),
            payload: null
          })
        }),
      { retry: { delay: "1 second", maxAttempts: 8, parkedDelay: "1 hour" } }
    )
    return {
      // Before accepting production; after commit this is only a latency nudge.
      // Preserve earlier pending work instead of postponing it on every request.
      prearm: Effect.gen(function* () {
        if ((yield* callback.getStatus("billing")) === undefined) {
          yield* callback.schedule("billing", { after: repairMillis, payload: null })
        }
      }),
      nudge: callback.schedule("billing", { after: 1000, payload: null })
    }
  })
