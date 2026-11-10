import { Context, Effect, Layer, Schema } from "effect"
import type { JobId } from "effect-jobs/JobId"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import {
  ResetCommand,
  ResetResult,
  ScenarioCommand,
  ScenarioResult
} from "@effect-jobs/playground-contracts/Scenarios"
import type { ReceiptRequest } from "@effect-jobs/playground-contracts/Scenarios"
import { PlaygroundError, Scenarios } from "@effect-jobs/playground-contracts/Services"
import type { PlannedJob } from "../../scenarios/Plan.js"

export type StoredReceipt = typeof StoredReceipt.Type
export const StoredReceipt = Schema.Union([
  Schema.TaggedStruct("Scenario", {
    command: ScenarioCommand,
    result: ScenarioResult.members[0]
  }),
  Schema.TaggedStruct("Reset", { command: ResetCommand, result: ResetResult })
])

export class CommandTransactionFailure extends Schema.TaggedError<CommandTransactionFailure>()(
  "CommandTransactionFailure",
  { commitKnowledge: Schema.Literals(["NotCommitted", "Unknown"]) }
) {}
export type StoreError = PlaygroundError | CommandTransactionFailure

// Application-only port proposal. No structural SQL handle or library lifecycle authority.
// The owner locks the sandbox BEFORE invoking body, using DB time; owns the
// exact ambient producer connection, bounded COMMIT/rollback/release, and never retries.
export interface CommandTransaction {
  // Proven first submission, never inferred from absence of a result receipt.
  readonly admission: "Fresh" | "Unresolved"
  readonly current: SandboxRef
  readonly dbNow: number
  readonly expiresAt: number
  readonly receipt: (
    request: ReceiptRequest,
    operation: "Scenario" | "Reset"
  ) => Effect.Effect<StoredReceipt | null, StoreError>
  readonly reserve: (count: number) => Effect.Effect<void, StoreError>
  readonly associate: (
    jobId: JobId,
    job: PlannedJob
  ) => Effect.Effect<void, CommandTransactionFailure>
  readonly advanceGeneration: (
    expected: SandboxRef
  ) => Effect.Effect<SandboxRef, StoreError>
  readonly saveReceipt: (
    receipt: StoredReceipt
  ) => Effect.Effect<void, CommandTransactionFailure>
  readonly audit: (entry: {
    readonly operation: "Scenario" | "Reset"
    readonly reason: "synthetic-scenario" | "generation-revocation"
    readonly count: number
  }) => Effect.Effect<void, CommandTransactionFailure>
}
export class CommandTransactions extends Context.Service<
  CommandTransactions,
  {
    readonly owned: <A, E, R>(
      access: SandboxAccess,
      request: ReceiptRequest,
      operation: "Scenario" | "Reset",
      body: (transaction: CommandTransaction) => Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | StoreError, R>
    // Read-only, DB-time expiry checked, scoped to the authenticated sandbox.
    // Old generations may be read for exact reset reconciliation, never written.
    readonly lookup: (
      access: SandboxAccess,
      request: ReceiptRequest,
      operation: "Scenario" | "Reset"
    ) => Effect.Effect<StoredReceipt | null, StoreError>
  }
>()("playground/CommandTransactions") {}

export class CommandPersistence extends Context.Service<
  CommandPersistence,
  typeof Scenarios.Service
>()("playground/CommandPersistence") {}

// Explicit default while authority/transaction persistence remains unqualified.
const unavailable = () =>
  Effect.fail(new PlaygroundError({ code: "capability-unavailable" }))
export const unavailableLayer = Layer.succeed(
  CommandPersistence,
  CommandPersistence.of({
    run: unavailable,
    reset: unavailable,
    scenarioReceipt: unavailable,
    resetReceipt: unavailable
  })
)
