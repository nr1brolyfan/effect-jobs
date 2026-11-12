/** Generic configured producer service; contains no SQL implementation imports. */
import { Context, Data } from "effect"
import type { Effect } from "effect"
import type {
  EnqueueResult,
  JobIntegrityConflict,
  JobPolicyIncompatible,
  PreparedJob
} from "./JobContract.js"
import type { JobsTransactionClosed } from "./JobTransaction.js"

/** Safe persistence failure preserving commit knowledge and transaction misuse.
 * No SQL, credentials, provider Causes or payloads are retained.
 * @category errors
 */
export class JobPersistenceError extends Data.TaggedError("JobPersistenceError")<{
  readonly reason:
    | "transaction-required"
    | "active-transaction"
    | "unqualified-storage"
    | "storage-failure"
  readonly commitKnowledge: "NotCommitted" | "Unknown"
}> {}
/** The configured producer owns presence checks and the transaction; preparation preserves E/R.
 * enqueue joins only an active configured transaction. Standalone owns the entire
 * prepare/insert/commit operation and returns after commit acknowledgement.
 * @category models
 */
export interface JobEnqueueService {
  readonly enqueue: <E, R>(
    prepared: Effect.Effect<PreparedJob, E, R>
  ) => Effect.Effect<
    EnqueueResult,
    | E
    | JobPersistenceError
    | JobIntegrityConflict
    | JobPolicyIncompatible
    | JobsTransactionClosed,
    R
  >
  readonly enqueueStandalone: <E, R>(
    prepared: Effect.Effect<PreparedJob, E, R>
  ) => Effect.Effect<
    EnqueueResult,
    | E
    | JobPersistenceError
    | JobIntegrityConflict
    | JobPolicyIncompatible
    | JobsTransactionClosed,
    R
  >
}
/** Configured application storage; provided by a qualified persistence Layer.
 * @category services
 */
export class JobEnqueue extends Context.Service<JobEnqueue, JobEnqueueService>()(
  "effect-jobs/JobEnqueue"
) {}
