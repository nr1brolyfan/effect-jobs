/**
 * Opaque invocation-scoped enqueue capabilities supplied by qualified backends.
 */
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

/**
 * Typed failure when enqueue runs after its backend callback has exited.
 *
 * @category errors
 */
export class JobsTransactionClosed extends Data.TaggedError("JobsTransactionClosed")<{
  readonly reason: "callback-exited"
}> {
  override get message(): string {
    return "JobsTransaction is closed; enqueue inside the backend joinTransaction callback"
  }
}
/**
 * Backend callback capability; never fabricate or retain it outside the callback.
 * E and R preserve backend errors and requirements. No public constructor, SQL,
 * commit, rollback or replay authority; sequence operations on the same transaction.
 *
 * @category models
 */
export interface JobsTransaction<E = never, R = never> {
  readonly [JobsTransactionTypeId]: {
    readonly insertOrCompare: (
      prepared: PreparedJob
    ) => Effect.Effect<EnqueueResult, E | JobIntegrityConflict | JobsTransactionClosed, R>
  }
}
/**
 * Core enqueue failures; backend errors remain in the caller's separate E channel.
 *
 * @category models
 */
export type JobEnqueueError =
  | InvalidJobInput
  | JobPayloadCodecError
  | JobIntegrityConflict
  | JobsTransactionClosed

/**
 * Qualified application manager port, delegating join-or-establish without a
 * second transaction engine. The outer application owner controls commit and replay.
 *
 * @category models
 */
export interface JobTransactionsService<ManagerError, ManagerRequirements = never> {
  readonly withTransaction: <A, E, R>(
    body: (jobsTx: JobsTransaction<ManagerError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | ManagerError, R | ManagerRequirements>
}
