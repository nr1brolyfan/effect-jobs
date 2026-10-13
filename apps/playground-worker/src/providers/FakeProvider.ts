import { Context, Data, Effect } from "effect"
import type { ProducerIdentity } from "effect-jobs/JobIdentity"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type { Behavior, ProviderWorkload } from "../scenarios/Definitions.js"

export class RetryRejected extends Data.TaggedError("RetryRejected")<{}> {}
export class TerminalRejected extends Data.TaggedError("TerminalRejected")<{}> {}
export class InvariantViolation extends Data.TaggedError("InvariantViolation")<{}> {}
export class ResponseLost extends Data.TaggedError("ResponseLost")<{}> {}
export class PayloadConflict extends Data.TaggedError("PayloadConflict")<{}> {}
export class LedgerFull extends Data.TaggedError("LedgerFull")<{}> {}
export type ProviderFailure =
  | RetryRejected
  | TerminalRejected
  | InvariantViolation
  | ResponseLost
  | PayloadConflict
  | LedgerFull

export interface ProviderIdentity {
  readonly sandbox: SandboxRef
  readonly producer: ProducerIdentity
}
export interface ProviderCommand extends ProviderIdentity {
  readonly workload: ProviderWorkload
  readonly behavior: Behavior
  readonly semanticProjection: Uint8Array
}
// Application observation only. Never a library attempt history or durable receipt.
export interface LedgerObservation {
  readonly source: "mock"
  readonly accepted: boolean
  readonly invocations: number
  readonly effects: 0 | 1
}
export interface FakeProviderService {
  readonly execute: (command: ProviderCommand) => Effect.Effect<void, ProviderFailure>
  readonly inspect: (
    identity: ProviderIdentity
  ) => Effect.Effect<LedgerObservation | undefined>
}
export class FakeProvider extends Context.Service<FakeProvider, FakeProviderService>()(
  "playground/FakeProvider"
) {}
