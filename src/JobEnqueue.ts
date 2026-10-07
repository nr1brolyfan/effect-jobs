/** Generic configured producer service; contains no backend imports. */
import { Context, Data } from "effect"
import type { Effect } from "effect"
import type { EnqueueResult, JobIntegrityConflict, PreparedJob } from "./JobContract.js"

/** Safe backend failure preserving commit knowledge and transaction misuse.
 * No SQL, credentials, provider Causes or payloads are retained.
 * @category errors
 */
export class JobBackendError extends Data.TaggedError("JobBackendError")<{
  readonly reason:
    | "transaction-required"
    | "active-transaction"
    | "unqualified-backend"
    | "storage-failure"
  readonly commitKnowledge: "NotCommitted" | "Unknown"
}> {}
/** Backend owns presence checks and the transaction; preparation preserves E/R.
 * enqueue joins only an active configured transaction. Standalone owns the entire
 * prepare/insert/commit operation and returns after commit acknowledgement.
 * @category models
 */
export interface JobEnqueueService {
  readonly enqueue: <E, R>(
    prepared: Effect.Effect<PreparedJob, E, R>
  ) => Effect.Effect<EnqueueResult, E | JobBackendError | JobIntegrityConflict, R>
  readonly enqueueStandalone: <E, R>(
    prepared: Effect.Effect<PreparedJob, E, R>
  ) => Effect.Effect<EnqueueResult, E | JobBackendError | JobIntegrityConflict, R>
}
/** Configured application storage; provided by a qualified backend Layer.
 * @category services
 */
export class JobEnqueue extends Context.Service<JobEnqueue, JobEnqueueService>()(
  "effect-jobs/JobEnqueue"
) {}
