/**
 * Opaque invocation-scoped enqueue capabilities supplied by qualified persistence implementations.
 */
import { Data } from "effect"
import type { Effect } from "effect"
import type {
  EnqueueResult,
  JobIntegrityConflict,
  JobPolicyIncompatible,
  PreparedJob,
  InvalidJobInput,
  JobPayloadCodecError
} from "./JobContract.js"
import type { JobsTransactionTypeId } from "./internal/JobTransaction.js"
import type { InvalidOperationId } from "./JobIdentity.js"

/**
 * Typed failure when enqueue runs after its transaction callback has exited.
 *
 * @category errors
 */
export class JobsTransactionClosed extends Data.TaggedError("JobsTransactionClosed")<{
  readonly reason: "callback-exited"
}> {
  override get message(): string {
    return "JobsTransaction is closed; enqueue inside the jobs.joinTransaction callback"
  }
}
/**
 * Transaction callback capability; never fabricate or retain it outside the callback.
 * E and R preserve storage errors and requirements. No public constructor, SQL,
 * commit, rollback or replay authority; sequence operations on the same transaction.
 *
 * @category models
 */
export interface JobsTransaction<E = never, R = never> {
  readonly [JobsTransactionTypeId]: {
    readonly assertActive: Effect.Effect<void, JobsTransactionClosed>
    readonly insertOrCompare: (
      prepared: PreparedJob
    ) => Effect.Effect<
      EnqueueResult,
      E | JobIntegrityConflict | JobPolicyIncompatible | JobsTransactionClosed,
      R
    >
  }
}
/**
 * Core enqueue failures; storage errors remain in the caller's separate E channel.
 *
 * @category models
 */
export type JobEnqueueError =
  | InvalidJobInput
  | InvalidOperationId
  | JobPayloadCodecError
  | JobIntegrityConflict
  | JobPolicyIncompatible
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
