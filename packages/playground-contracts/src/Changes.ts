import { Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { SandboxRef } from "./Sandbox.js"
import { Cursor } from "./Jobs.js"

// Hint only: reconcile authoritative reads after gaps, reconnects and periodically.
export type Invalidation = typeof Invalidation.Type
export const Invalidation = Schema.Struct({
  sandbox: SandboxRef,
  cursor: Cursor,
  reason: Schema.Literals(["jobs-changed", "reset", "reconcile"]),
  jobIds: Schema.Array(JobId).pipe(Schema.check(Schema.isMaxLength(50)))
})
export type ChangeRequest = typeof ChangeRequest.Type
export const ChangeRequest = Schema.Struct({
  sandbox: SandboxRef,
  after: Cursor.pipe(Schema.optional)
})
export type ChangeBatch = typeof ChangeBatch.Type
export const ChangeBatch = Schema.Struct({
  sandbox: SandboxRef,
  mode: Schema.Literals(["poll-only", "notifications"]),
  reconcile: Schema.Boolean,
  hints: Schema.Array(Invalidation).pipe(Schema.check(Schema.isMaxLength(50)))
})
