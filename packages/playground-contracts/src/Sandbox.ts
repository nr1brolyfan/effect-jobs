import { Schema } from "effect"
import { EpochMillis } from "effect-jobs/JobPolicy"

const opaque = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))
)
export const SandboxId = opaque.pipe(Schema.brand("playground/SandboxId"))
export type SandboxId = typeof SandboxId.Type
export const Generation = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
)
export const SandboxRef = Schema.Struct({ sandboxId: SandboxId, generation: Generation })
export type SandboxRef = typeof SandboxRef.Type
export const Capabilities = Schema.Struct({
  runScenario: Schema.Boolean,
  resetSandbox: Schema.Boolean,
  retryJob: Schema.Boolean,
  cancelJob: Schema.Boolean,
  redriveJob: Schema.Boolean
})
export type Capabilities = typeof Capabilities.Type
export const SandboxView = Schema.Struct({
  ref: SandboxRef,
  expiresAt: EpochMillis,
  capacity: Schema.optional(
    Schema.Struct({
      mode: Schema.Literals(["local", "bounded"]),
      retainedJobs: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
      ),
      admittedCommands: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
      )
    })
  ),
  capabilities: Capabilities
})
export type SandboxView = typeof SandboxView.Type
// Server-only authenticated context. Never serialize or accept directly from a request body.
export interface SandboxAccess {
  readonly sandbox: SandboxView
}
export const limits = Object.freeze({
  pageSize: 50,
  jobsPerSandbox: 100,
  scenarioBatch: 10,
  sandboxLifetimeMillis: 3_600_000,
  reconciliationMillis: 5_000
})
