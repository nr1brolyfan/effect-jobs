import { DateTime, Duration, Effect, Schedule } from "effect"
import * as Policy from "../../src/JobPolicy.js"
import * as Retry from "../../src/JobRetryPolicy.js"
import * as FailureCodes from "../../src/FailureCode.js"
import { JobFailures } from "../../src/JobFailure.js"

const retry = Retry.exponential(Duration.seconds(1)).pipe(
  Retry.capped(Duration.minutes(1)),
  Retry.jittered(),
  Retry.maxFinalizedAttempts(5)
)
export const policy = Policy.make({ retry })
const typed: Effect.Effect<Policy.JobPolicy, Policy.JobPolicyConfigurationError> = policy
void typed
export const fixed = Policy.make({ retry: Retry.fixed(Duration.seconds(5)) })
// @ts-expect-error Removed shorthand is not a policy option.
export const removedDelay = Policy.make({ retryDelay: Duration.seconds(5) })
// @ts-expect-error The attempt limit belongs to the retry description only.
export const removedAttempts = Policy.make({ maxAttempts: 3 })
// @ts-expect-error Removed builder spelling; the limit counts finalizations, not invocations.
export const removedBuilder = Retry.maxAttempts(3)
// @ts-expect-error Stored maxAttempts is not a resolved policy field.
export const removedPolicyField = Policy.defaultPolicy.maxAttempts
// @ts-expect-error In-memory schedules are not durable retry descriptions.
const invalidSchedule = Policy.make({ retry: Schedule.exponential(Duration.seconds(1)) })
void invalidSchedule
// @ts-expect-error Public duration inputs use Effect Duration, not bare numbers.
Retry.exponential(1000)
// @ts-expect-error Retry is not a full job policy.
const incomplete: Policy.JobPolicy = retry
void incomplete
// @ts-expect-error Effectful validation must be evaluated before a policy can be used.
const unresolved: Policy.JobPolicy = policy
void unresolved

const retryCode = FailureCodes.define({ temporary: "temporary" }).temporary
export const retryCutoff = JobFailures.Retry({
  code: retryCode,
  retryBefore: DateTime.makeUnsafe(1000)
})
// @ts-expect-error Unknown outcomes carry no code.
export const codedOutcome = JobFailures.OutcomeUnknown({
  code: FailureCodes.define({ value: "lost" }).value
})
// @ts-expect-error A retry cutoff requires an absolute UTC instant.
export const numericCutoff = JobFailures.Retry({ ...retryCutoff, retryBefore: 1000 })
export const relativeCutoff = JobFailures.Retry({
  ...retryCutoff,
  // @ts-expect-error A duration is relative and cannot express a retry cutoff.
  retryBefore: Duration.seconds(1)
})
