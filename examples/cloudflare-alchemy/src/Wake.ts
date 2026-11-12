import * as Alchemy from "alchemy/Callback"
import { Clock, Effect, Schema, Semaphore } from "effect"
import { DurableObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState"
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
    const state = yield* DurableObjectState
    const scheduling = yield* Semaphore.make(1)
    // Serialize sibling fibers too: the native transaction is owned by one fiber.
    const atomic = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      scheduling.withPermit(state.storage.transaction(effect))
    const ensureEarlier = (delay: number, absentOnly = false) =>
      atomic(
        Effect.gen(function* () {
          const status = yield* callback.getStatus("billing")
          const at = (yield* Clock.currentTimeMillis) + delay
          // retryAt can be later than scheduledAt, especially for parked callbacks.
          if (
            status === undefined ||
            (!absentOnly && Math.max(status.scheduledAt, status.retryAt ?? 0) > at)
          ) {
            yield* callback.schedule("billing", { at, payload: null })
          }
        })
      ).pipe(
        Effect.mapError((error) =>
          error._tag === "CallbackError"
            ? error
            : new Alchemy.CallbackError({
                callback: "billing-drain",
                message: "Wake storage transaction failed"
              })
        )
      )
    const callback: Alchemy.Callback<null> = yield* Alchemy.makeCallback(
      "billing-drain",
      (_payload: null) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(Schema.Null)(_payload)
          // Durable prearm BEFORE any SQL/external execution. Replacement survives old-version ack.
          yield* scheduling.withPermit(
            callback.schedule("billing", { after: repairMillis, payload: null })
          )
          const value = yield* run
          yield* ensureEarlier(nextDelay(value.result, value.hint))
        }),
      { retry: { delay: "1 second", maxAttempts: 8, parkedDelay: "1 hour" } }
    )
    return {
      // Before accepting production; after commit this is only a latency nudge.
      // Preserve earlier pending work instead of postponing it on every request.
      // getStatus and schedule join ONE native transaction, including alarm reconciliation.
      prearm: ensureEarlier(repairMillis, true),
      nudge: ensureEarlier(1000)
    }
  })
