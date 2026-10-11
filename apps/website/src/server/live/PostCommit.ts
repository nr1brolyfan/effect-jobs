import { Context, Effect, Layer } from "effect"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"

export class LiveNotifications extends Context.Service<
  LiveNotifications,
  {
    readonly committed: (sandbox: SandboxRef) => Effect.Effect<void>
  }
>()("playground/LiveNotifications") {}

export interface LiveNamespace {
  getByName(name: string): { notifyCommitted(sandbox: SandboxRef): Promise<void> }
}
export const objectName = (sandbox: SandboxRef) =>
  JSON.stringify([sandbox.sandboxId, sandbox.generation])
// Call ONLY after acknowledged outer commit or read-only receipt reconciliation.
// No library hook exists for claim/finalize/recovery. Missing hints are repaired by reads.
export const layer = (namespace: LiveNamespace) =>
  Layer.succeed(LiveNotifications, {
    committed: (sandbox) =>
      Effect.tryPromise({
        try: () => namespace.getByName(objectName(sandbox)).notifyCommitted(sandbox),
        catch: () => undefined
      }).pipe(Effect.timeout("1 second"), Effect.ignore)
  })
