/** Ambient transaction-only manual operators. Applications own authority and receipts. */
import { Context, Data, Schema } from "effect"
import type { Effect } from "effect"
import type { JobBackendError } from "./JobEnqueue.js"
import type { JobDefinition } from "./Job.js"
import type { JobIntegrityConflict, JobPayloadCodecError } from "./JobContract.js"
import { JobId } from "./JobId.js"
import { ProducerIdentity } from "./JobIdentity.js"
import { Counter, JobSnapshot, JobState } from "./JobLifecycle.js"
import { EpochMillis } from "./JobPolicy.js"

/** Exact source state/version guard. @category schemas */
export const JobOperatorExpected = Schema.Struct({
  jobId: JobId,
  state: JobState,
  lifecycleVersion: Counter
})
/** @category models */
export type JobOperatorExpected = typeof JobOperatorExpected.Type
/** Provisional transition evidence; commit belongs to the application. @category schemas */
export const JobOperatorTransition = Schema.Struct({
  jobId: JobId,
  beforeState: JobState,
  beforeVersion: Counter,
  after: JobSnapshot
})
/** @category models */
export type JobOperatorTransition = typeof JobOperatorTransition.Type
/** New producer identity, never the original tuple. @category schemas */
export const JobRedriveRequest = Schema.Struct({
  expected: JobOperatorExpected,
  producer: ProducerIdentity
})
/** @category models */
export type JobRedriveRequest = typeof JobRedriveRequest.Type
/** Source remains unchanged; timestamp is sampled after validation. @category schemas */
export const JobRedriveResult = Schema.Struct({
  source: JobOperatorExpected,
  jobId: JobId,
  inserted: Schema.Boolean,
  dbNow: EpochMillis
})
/** @category models */
export type JobRedriveResult = typeof JobRedriveResult.Type
/** Bounded rejection; no SQL, payload or provider diagnostics. @category errors */
export class JobOperatorRejected extends Data.TaggedError("JobOperatorRejected")<{
  readonly reason:
    | "invalid-input"
    | "not-found"
    | "state-version-conflict"
    | "not-eligible"
    | "already-due"
    | "invalid-artifact"
    | "unsupported-catalog"
    | "arithmetic-bound"
}> {}
/** All successes are provisional until the outer owner commits. @category models */
export interface JobOperatorsService<E = never, R = never> {
  readonly retryNow: (
    expected: JobOperatorExpected
  ) => Effect.Effect<JobOperatorTransition, E | JobOperatorRejected, R>
  readonly cancel: (
    expected: JobOperatorExpected
  ) => Effect.Effect<JobOperatorTransition, E | JobOperatorRejected, R>
  readonly redrive: <S extends Schema.Top>(
    definition: Pick<JobDefinition<S>, "catalog" | "payload">,
    request: JobRedriveRequest
  ) => Effect.Effect<
    JobRedriveResult,
    E | JobOperatorRejected | JobPayloadCodecError | JobIntegrityConflict,
    R | S["DecodingServices"]
  >
}
/** Trusted application composition, not caller authentication. @category services */
export class JobOperators extends Context.Service<
  JobOperators,
  JobOperatorsService<JobBackendError>
>()("effect-jobs/JobOperators") {}
