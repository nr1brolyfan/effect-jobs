import { Data } from "effect"
import type { Effect } from "effect"
import type {
  EnqueueResult,
  JobIntegrityConflict,
  PreparedJob,
  InvalidJobInput,
  JobPayloadCodecError
} from "./JobContract.js"
import type { JobsTransactionTypeId } from "./internal/JobTransaction.js"

export class JobsTransactionClosed extends Data.TaggedError("JobsTransactionClosed")<{
  readonly reason: "callback-exited"
}> {
  override get message(): string {
    return "JobsTransaction is closed; enqueue inside the backend joinTransaction callback"
  }
}
/** Backend callback capability. No public constructor or commit/replay operations. */
export interface JobsTransaction<E = never, R = never> {
  readonly [JobsTransactionTypeId]: {
    readonly insertOrCompare: (
      prepared: PreparedJob
    ) => Effect.Effect<EnqueueResult, E | JobIntegrityConflict | JobsTransactionClosed, R>
  }
}
export type JobEnqueueError =
  | InvalidJobInput
  | JobPayloadCodecError
  | JobIntegrityConflict
  | JobsTransactionClosed

/** Implemented by a qualified application manager integration, not a core engine. */
export interface JobTransactionsService<ManagerError, ManagerRequirements = never> {
  readonly withTransaction: <A, E, R>(
    body: (jobsTx: JobsTransaction<ManagerError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | ManagerError, R | ManagerRequirements>
}
