import type {
  JobOperatorCommand,
  JobOperatorResult,
  JobOperatorReceiptRequest
} from "@effect-jobs/playground-contracts/Operators"
import { Context, Effect } from "effect"
import type {
  JobDetailRequest,
  ListJobs,
  JobPage,
  JobDetail
} from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type {
  ScenarioCommand,
  ScenarioResult,
  ResetCommand,
  ResetResult,
  ReceiptRequest
} from "@effect-jobs/playground-contracts/Scenarios"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"

// Browser port. The HTTP owner supplies cookie/origin enforcement; no SandboxAccess
// or credential enters this interface. No production endpoint is guessed here.
export interface Client {
  readonly operate: (
    command: JobOperatorCommand
  ) => Effect.Effect<JobOperatorResult, PlaygroundError>
  readonly operatorReceipt: (
    request: JobOperatorReceiptRequest
  ) => Effect.Effect<JobOperatorResult, PlaygroundError>
  readonly source: "mock" | "local" | "workerd" | "hosted"
  readonly describe: () => Effect.Effect<SandboxView, PlaygroundError>
  readonly list: (request: ListJobs) => Effect.Effect<JobPage, PlaygroundError>
  readonly detail: (
    request: JobDetailRequest
  ) => Effect.Effect<JobDetail, PlaygroundError>
  readonly run: (
    command: ScenarioCommand
  ) => Effect.Effect<ScenarioResult, PlaygroundError>
  readonly reset: (command: ResetCommand) => Effect.Effect<ResetResult, PlaygroundError>
  readonly scenarioReceipt: (
    request: ReceiptRequest
  ) => Effect.Effect<ScenarioResult, PlaygroundError>
  readonly resetReceipt: (
    request: ReceiptRequest
  ) => Effect.Effect<ResetResult, PlaygroundError>
}

export class JobsClient extends Context.Service<JobsClient, Client>()(
  "website/JobsClient"
) {}
