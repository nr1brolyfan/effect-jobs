import { Schema } from "effect"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"

export type Signal = typeof Signal.Type
export const Signal = Schema.Struct({
  kind: Schema.Literals(["ready", "invalidate"]),
  sandbox: SandboxRef,
  reason: Schema.Literals(["jobs-changed", "reconcile"]),
  sequence: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
  )
})
export const Ack = Schema.Struct({
  kind: Schema.Literal("ack"),
  sequence: Signal.fields.sequence
})
export const sameSandbox = (left: SandboxRef, right: SandboxRef) =>
  left.sandboxId === right.sandboxId && left.generation === right.generation

export const liveLimits = Object.freeze({
  viewers: 16,
  messageBytes: 1024,
  coalesceMillis: 1000,
  ackMillis: 10_000
})
