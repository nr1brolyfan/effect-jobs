import { Context, Effect, Schema } from "effect"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  JobRepairResult,
  JobResolutionResult
} from "@effect-jobs/playground-contracts/Repairs"
import type {
  JobRepairCommand,
  JobRepairReceiptRequest,
  JobResolutionCommand,
  JobProblem
} from "@effect-jobs/playground-contracts/Repairs"
import type { StoreError } from "./Transactions.js"

// Durable receipt contains bounded metadata/digest, NEVER a second payload copy.
export const StoredRepairReceipt = Schema.Struct({
  commandDigest: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/u))),
  result: Schema.Union([
    JobRepairResult.members[0],
    JobRepairResult.members[1],
    JobResolutionResult.members[0],
    JobResolutionResult.members[1]
  ])
})
export type StoredRepairReceipt = typeof StoredRepairReceipt.Type
export type RepairCommand = JobRepairCommand | JobResolutionCommand
export type RepairResult = JobRepairResult | JobResolutionResult
export interface RepairTransaction {
  readonly admission: "Fresh" | "Unresolved" | "Conflict"
  readonly stored: StoredRepairReceipt | null
  readonly assertCurrent: Effect.Effect<void, StoreError>
  readonly now: Effect.Effect<number, StoreError>
  readonly source: () => Effect.Effect<
    Readonly<Record<string, unknown>> | null,
    StoreError
  >
  readonly problem: () => Effect.Effect<JobProblem | null, StoreError>
  readonly associate: (
    resultJobId: string,
    problem: JobProblem
  ) => Effect.Effect<void, StoreError>
  readonly save: (
    result: Exclude<RepairResult, { _tag: "OutcomeUnknown" }>,
    changes?: ReadonlyArray<{ readonly kind: string; readonly path: string }> | null
  ) => Effect.Effect<void, StoreError>
}
export class RepairTransactions extends Context.Service<
  RepairTransactions,
  {
    readonly owned: <A, E, R>(
      access: SandboxAccess,
      command: RepairCommand,
      digest: string,
      body: (tx: RepairTransaction) => Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | StoreError, R>
    readonly lookup: (
      access: SandboxAccess,
      request: JobRepairReceiptRequest,
      operation: "Repair" | "Resolution"
    ) => Effect.Effect<StoredRepairReceipt | null, StoreError>
  }
>()("playground/RepairTransactions") {}
// Internal capability composed ONLY for trusted seed code, never HTTP input.
export class SyntheticRepairTransactions extends Context.Service<
  SyntheticRepairTransactions,
  typeof RepairTransactions.Service
>()("playground/SyntheticRepairTransactions") {}
