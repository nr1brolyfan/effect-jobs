import { Context, Effect, Redacted, Schema } from "effect"
import type { SandboxAccess, SandboxView } from "./Sandbox.js"
import type {
  JobDetail,
  JobDetailRequest,
  JobPage,
  ListJobs,
  JobProblemPage,
  JobHistory,
  JobRelatedPage,
  JobDetailPageRequest
} from "./Jobs.js"
import type {
  ReceiptRequest,
  ResetCommand,
  ResetResult,
  ScenarioCommand,
  ScenarioResult
} from "./Scenarios.js"
import type { ChangeBatch, ChangeRequest } from "./Changes.js"

export const PublicErrorCode = Schema.Literals([
  "invalid-request",
  "not-found",
  "sandbox-expired",
  "stale-generation",
  "limit-reached",
  "capability-unavailable",
  "unavailable"
])
export type PublicErrorCode = typeof PublicErrorCode.Type
export const PublicError = Schema.Struct({ code: PublicErrorCode })
export class PlaygroundError extends Schema.TaggedError<PlaygroundError>()(
  "PlaygroundError",
  { code: PublicErrorCode }
) {}
export const toPublicError = (error: PlaygroundError): typeof PublicError.Type => ({
  code: error.code
})
export interface IssuedSandbox {
  readonly sandbox: SandboxView
  readonly credential: Redacted.Redacted<string>
}
export class SandboxAuthority extends Context.Service<
  SandboxAuthority,
  {
    readonly issue: () => Effect.Effect<IssuedSandbox, PlaygroundError>
    readonly authenticate: (
      credential: Redacted.Redacted<string>
    ) => Effect.Effect<SandboxAccess, PlaygroundError>
    // Creation/delivery of a new credential belongs to the HTTP boundary, never a DTO/log.
    readonly describe: (
      access: SandboxAccess
    ) => Effect.Effect<SandboxView, PlaygroundError>
  }
>()("playground/SandboxAuthority") {}
export class JobsRead extends Context.Service<
  JobsRead,
  {
    readonly list: (
      access: SandboxAccess,
      request: ListJobs
    ) => Effect.Effect<JobPage, PlaygroundError>
    readonly problems: (
      access: SandboxAccess,
      request: ListJobs
    ) => Effect.Effect<JobProblemPage, PlaygroundError>
    readonly history: (
      access: SandboxAccess,
      request: JobDetailPageRequest
    ) => Effect.Effect<JobHistory, PlaygroundError>
    readonly related: (
      access: SandboxAccess,
      request: JobDetailPageRequest
    ) => Effect.Effect<JobRelatedPage, PlaygroundError>
    readonly detail: (
      access: SandboxAccess,
      request: JobDetailRequest
    ) => Effect.Effect<JobDetail, PlaygroundError>
  }
>()("playground/JobsRead") {}
export class Scenarios extends Context.Service<
  Scenarios,
  {
    readonly run: (
      access: SandboxAccess,
      command: ScenarioCommand
    ) => Effect.Effect<ScenarioResult, PlaygroundError>
    // Read-only exact-request reconciliation. Absence is not permission to replay.
    readonly scenarioReceipt: (
      access: SandboxAccess,
      request: ReceiptRequest
    ) => Effect.Effect<ScenarioResult, PlaygroundError>
    readonly resetReceipt: (
      access: SandboxAccess,
      request: ReceiptRequest
    ) => Effect.Effect<ResetResult, PlaygroundError>
    readonly reset: (
      access: SandboxAccess,
      command: ResetCommand
    ) => Effect.Effect<ResetResult, PlaygroundError>
  }
>()("playground/Scenarios") {}
export class Changes extends Context.Service<
  Changes,
  {
    readonly read: (
      access: SandboxAccess,
      request: ChangeRequest
    ) => Effect.Effect<ChangeBatch, PlaygroundError>
  }
>()("playground/Changes") {}
