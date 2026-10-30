import { Duration, Schedule } from "effect"
import * as Policy from "../../src/JobPolicy.js"
import * as Retry from "../../src/JobRetryPolicy.js"

const retry = Retry.exponential(Duration.seconds(1)).pipe(
  Retry.capped(Duration.minutes(1)),
  Retry.jittered(),
  Retry.maxAttempts(5)
)
export const policy = Policy.make({ retry })
export const fixed = Policy.make({ retry: Retry.fixed(Duration.seconds(5)) })
// @ts-expect-error In-memory schedules are not durable retry descriptions.
Policy.make({ retry: Schedule.exponential(Duration.seconds(1)) })
// @ts-expect-error Public duration inputs use Effect Duration, not bare numbers.
Retry.exponential(1000)
// @ts-expect-error Retry is not a full job policy.
const incomplete: Policy.JobPolicy = retry
void incomplete
