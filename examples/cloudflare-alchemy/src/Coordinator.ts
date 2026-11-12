import * as Cloudflare from "@alchemy.run/cloudflare"
import { Config, Effect } from "effect"
import { connection } from "./Database.js"
import { openInvocation } from "./Invocation.js"
import { OperationUnconfirmed } from "./Domain.js"
import { makeWake } from "./Wake.js"

import type { CallbackError } from "alchemy/Callback"
import type { RuntimeContext } from "alchemy/RuntimeContext"

interface CoordinatorMethods {
  readonly prearm: () => Effect.Effect<void, CallbackError, RuntimeContext>
  readonly wake: () => Effect.Effect<void, CallbackError, RuntimeContext>
}
export class BillingCoordinator extends Cloudflare.DurableObject<
  BillingCoordinator,
  CoordinatorMethods
>()("BillingCoordinator") {}

export default BillingCoordinator.make(
  Effect.gen(function* () {
    // Stable configuration only in construction. No SQL is acquired here.
    const database = yield* connection
    const databaseUrl = database.connectionString
    const providerUrl = yield* Config.String("EXAMPLE_PROVIDER_URL")
    return Effect.gen(function* () {
      // Per-instance init registers the callback before any RPC/alarm delivery.
      const wake = yield* makeWake(
        Effect.scoped(
          Effect.gen(function* () {
            const invocation = yield* openInvocation({ databaseUrl, providerUrl })
            const result = yield* invocation.drain
            const hint = yield* invocation.observe
            return { result, hint }
          })
        ).pipe(
          Effect.timeoutOrElse({
            duration: "12 seconds",
            orElse: () => Effect.fail(new OperationUnconfirmed())
          }),
          Effect.mapError(() => new OperationUnconfirmed())
        )
      )
      return { prearm: () => wake.prearm, wake: () => wake.nudge }
    })
  }).pipe(Effect.orDie)
)
