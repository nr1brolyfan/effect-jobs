import { Duration, Effect, Schedule } from "effect"
import * as Policy from "../../src/JobPolicy.js"
import * as Retry from "../../src/JobRetryPolicy.js"

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
