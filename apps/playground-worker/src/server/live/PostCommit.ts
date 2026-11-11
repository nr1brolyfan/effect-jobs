import { Context, Effect, Layer } from "effect"
import type * as Cloudflare from "@alchemy.run/cloudflare"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"

export class LiveNotifications extends Context.Service<
  LiveNotifications,
  {
    readonly committed: (sandbox: SandboxRef) => Effect.Effect<void>
  }
>()("playground/LiveNotifications") {}

export type LiveNamespace = Pick<
  Cloudflare.DurableObject<{
    readonly notifyCommitted: (sandbox: SandboxRef) => Effect.Effect<void>
  }>,
  "getByName"
>
export const objectName = (sandbox: SandboxRef) =>
  JSON.stringify([sandbox.sandboxId, sandbox.generation])
// Call ONLY after acknowledged outer commit or read-only receipt reconciliation.
// No library hook exists for claim/finalize/recovery. Missing hints are repaired by reads.
export const layer = (namespace: LiveNamespace) =>
  Layer.succeed(LiveNotifications, {
    committed: (sandbox) =>
      namespace
        .getByName(objectName(sandbox))
        .notifyCommitted(sandbox)
        .pipe(Effect.timeout("1 second"), Effect.ignore)
  })
