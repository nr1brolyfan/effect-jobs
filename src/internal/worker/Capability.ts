import { Data } from "effect"
import type { Effect, Semaphore } from "effect"
import type { JobConsumer } from "../../JobConsumer.js"

/** Explicit per-worker wiring; not exported as a package subpath. */
export const WorkerCapability: unique symbol = Symbol("effect-jobs/worker/capability")

export class JobWorkerUnavailable extends Data.TaggedError("JobWorkerUnavailable")<{}> {}
export class JobWorkerNotReady extends Data.TaggedError("JobWorkerNotReady")<{}> {}
export class JobWorkerConfigurationError extends Data.TaggedError(
  "JobWorkerConfigurationError"
)<{
  readonly field:
    | "catalog"
    | "operationResponseBudgetMillis"
    | "consumer"
    | "idlePollMillis"
    | "queues"
    | "drain"
    | "polling"
}> {}

export type DispatchResult = Data.TaggedEnum<{
  Empty: {}
  Unresolved: {}
  Started: {
    readonly execution: Effect.Effect<void>
    readonly release: Effect.Effect<void>
  }
}>
export const DispatchResult = Data.taggedEnum<DispatchResult>()

export interface RuntimeCapability {
  readonly concurrency: (queue: string) => number | undefined
  readonly ready: (queue: string) => Effect.Effect<void, JobWorkerNotReady>
  readonly permits: (
    consumer: JobConsumer
  ) => Effect.Effect<Semaphore.Semaphore, JobWorkerConfigurationError>
  readonly claim: (queue: string) => Effect.Effect<DispatchResult, JobWorkerUnavailable>
  readonly recover: (
    queue: string,
    limit: number
  ) => Effect.Effect<number, JobWorkerUnavailable>
}
