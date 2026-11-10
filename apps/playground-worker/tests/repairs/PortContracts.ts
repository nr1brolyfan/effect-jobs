import { Context, Effect, Schema } from "effect"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import type { ReceiptRequest } from "@effect-jobs/playground-contracts/Scenarios"
import type {
  RepairCommand,
  RepairTransaction,
  RepairTransactions
} from "../../src/persistence/commands/RepairTransactions.js"
import {
  CommandTransactionFailure,
  type CommandTransaction,
  type CommandTransactions,
  type StoreError
} from "../../src/persistence/commands/Transactions.js"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

// Exact equality also rejects accidental never, broader unions and lost requirements.
export type Now = Assert<
  Equal<RepairTransaction["now"], Effect.Effect<number, CommandTransactionFailure>>
>
export type Associate = Assert<
  Equal<
    Effect.Error<ReturnType<CommandTransaction["associate"]>>,
    CommandTransactionFailure
  >
>
export type SaveReceipt = Assert<
  Equal<
    Effect.Error<ReturnType<CommandTransaction["saveReceipt"]>>,
    CommandTransactionFailure
  >
>
export type Audit = Assert<
  Equal<Effect.Error<ReturnType<CommandTransaction["audit"]>>, CommandTransactionFailure>
>
export type BroadRepairAssociate = Assert<
  Equal<Effect.Error<ReturnType<RepairTransaction["associate"]>>, StoreError>
>

const failure = new CommandTransactionFailure({ commitKnowledge: "Unknown" })
const domain = new PlaygroundError({ code: "unavailable" })
export const nowSuccess: RepairTransaction["now"] = Effect.succeed(1000)
export const nowFailure: RepairTransaction["now"] = Effect.fail(failure)
export const associateSuccess: CommandTransaction["associate"] = () => Effect.void
export const associateFailure: CommandTransaction["associate"] = () =>
  Effect.fail(failure)
export const receiptSuccess: CommandTransaction["saveReceipt"] = () => Effect.void
export const receiptFailure: CommandTransaction["saveReceipt"] = () =>
  Effect.fail(failure)
export const auditSuccess: CommandTransaction["audit"] = () => Effect.void
export const auditFailure: CommandTransaction["audit"] = () => Effect.fail(failure)

// Each directive becomes TS2578 if that individual port admits PlaygroundError again.
export type BadNow = Assert<
  // @ts-expect-error RepairTransaction.now cannot emit PlaygroundError.
  Effect.Effect<number, PlaygroundError> extends RepairTransaction["now"] ? true : false
>
export type BadAssociate = Assert<
  // @ts-expect-error CommandTransaction.associate cannot emit PlaygroundError.
  (() => Effect.Effect<void, PlaygroundError>) extends CommandTransaction["associate"]
    ? true
    : false
>
export type BadReceipt = Assert<
  // @ts-expect-error CommandTransaction.saveReceipt cannot emit PlaygroundError.
  (() => Effect.Effect<void, PlaygroundError>) extends CommandTransaction["saveReceipt"]
    ? true
    : false
>
export type BadAudit = Assert<
  // @ts-expect-error CommandTransaction.audit cannot emit PlaygroundError.
  (() => Effect.Effect<void, PlaygroundError>) extends CommandTransaction["audit"]
    ? true
    : false
>

export const repairAssociateDomain: RepairTransaction["associate"] = () =>
  Effect.fail(domain)
export const repairAssociateControl: RepairTransaction["associate"] = () =>
  Effect.fail(failure)

class CallbackFailure extends Schema.TaggedError<CallbackFailure>()(
  "CallbackFailure",
  {}
) {}
class CallbackDependency extends Context.Service<
  CallbackDependency,
  { readonly value: string }
>()("test/PortCallback") {}
const callback = Effect.gen(function* () {
  const dependency = yield* CallbackDependency
  if (dependency.value === "fail") {
    return yield* new CallbackFailure()
  }
  return dependency.value
})

export const ownedContracts = (
  commands: CommandTransactions["Service"],
  repairs: RepairTransactions["Service"],
  access: SandboxAccess,
  request: ReceiptRequest,
  command: RepairCommand
) => {
  const commandResult = commands.owned(access, request, "Scenario", () => callback)
  const repairResult = repairs.owned(access, command, "a".repeat(64), () => callback)
  // Exact output equality discriminates preserved callback A, arbitrary E and R.
  const commandProof: Assert<
    Equal<
      typeof commandResult,
      Effect.Effect<string, CallbackFailure | StoreError, CallbackDependency>
    >
  > = true
  const repairProof: Assert<
    Equal<
      typeof repairResult,
      Effect.Effect<string, CallbackFailure | StoreError, CallbackDependency>
    >
  > = true
  return { commandResult, repairResult, commandProof, repairProof }
}
