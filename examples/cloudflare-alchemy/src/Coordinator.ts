import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"
import { openInvocation } from "./Invocation.js"
import { OperationUnconfirmed } from "./Domain.js"
import { SharedConfig } from "./SharedConfig.js"
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
    const config = yield* SharedConfig
    return Effect.gen(function* () {
      // Per-instance init registers the callback before any RPC/alarm delivery.
      const wake = yield* makeWake(
        Effect.scoped(
          Effect.gen(function* () {
            const invocation = yield* openInvocation(config)
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
