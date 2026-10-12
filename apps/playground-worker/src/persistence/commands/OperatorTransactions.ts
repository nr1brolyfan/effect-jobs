import { Context, Effect, Schema } from "effect"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  JobOperatorCommand,
  JobOperatorReceiptRequest,
  JobOperatorResult
} from "@effect-jobs/playground-contracts/Operators"
import type { StoreError } from "./Transactions.js"

export const StoredOperatorReceipt = Schema.Struct({
  command: JobOperatorCommand,
  result: Schema.Union([JobOperatorResult.members[0], JobOperatorResult.members[1]])
})
export type StoredOperatorReceipt = typeof StoredOperatorReceipt.Type
export interface OperatorTransaction {
  readonly admission: "Fresh" | "Unresolved"
  readonly stored: StoredOperatorReceipt | null
  // The source is obtained only by scoped JOIN + parent lock in the same native
  // transaction. Immutable artifact bytes are private command-side evidence.
  readonly source: () => Effect.Effect<
    Readonly<Record<string, unknown>> | null,
    StoreError
  >
  readonly assertCurrent: Effect.Effect<void, StoreError>
  readonly associateRedrive: (
    result: Extract<JobOperatorResult, { _tag: "Committed" }>
  ) => Effect.Effect<void, StoreError>
  readonly save: (
    result: Exclude<JobOperatorResult, { _tag: "OutcomeUnknown" }>
  ) => Effect.Effect<void, StoreError>
}
export class OperatorTransactions extends Context.Service<
  OperatorTransactions,
  {
    readonly owned: <A, E, R>(
      access: SandboxAccess,
      command: JobOperatorCommand,
      body: (tx: OperatorTransaction) => Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | StoreError, R>
    readonly lookup: (
      access: SandboxAccess,
      request: JobOperatorReceiptRequest
    ) => Effect.Effect<StoredOperatorReceipt | null, StoreError>
  }
>()("playground/OperatorTransactions") {}
