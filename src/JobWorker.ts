/** Worker service and construction. Execution remains explicit and scoped. */
import { Context, Layer } from "effect"
import type { JobApi, Groups } from "./JobApi.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import type { RuntimeCapability } from "./internal/worker/Capability.js"
import * as GroupWorker from "./internal/worker/GroupWorker.js"
import type { Options } from "./internal/worker/GroupWorker.js"

/**
 * Runs bounded recovery and claims with concurrency fixed at worker construction.
 * Idle observes an empty claim; MoreWork reaches the run limit; Backoff requests
 * delayed retry after storage uncertainty. None promises exactly-once effects.
 *
 * @example
 * ```ts
 * import { Effect, Layer, Schema } from "effect"
 * import * as JobApi from "effect-jobs/JobApi"
 * import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Group from "effect-jobs/JobGroup"
 * import * as Worker from "effect-jobs/JobWorker"
 * import * as Storage from "effect-jobs/JobStorage"
 *
 * const queue = Queue.make("billing")
 * const group = Group.make("billing", {
 *   invoice: { kind: "invoice.generate", version: 1,
 *     payload: Schema.Struct({ invoiceId: Schema.String }) }
 * })
 * const api = JobApi.make("application").pipe(JobApi.addGroup(group))
 * // Application supplies qualified storage; construction starts no activity.
 * const runOnce = <E, R>(storage: Storage.Options<E, R>) => {
 *   const HandlerLayer = JobApiBuilder.group(api, "billing", (handlers) => handlers.handle("invoice", () => Effect.void))
 *   const WorkerLayer = Worker.layer(api, {
 *     queues: [{ queue, concurrency: 2 }]
 *   }).pipe(Layer.provide(Layer.mergeAll(HandlerLayer, Storage.layer(storage))))
 *   return Worker.drain(queue, { maxJobs: 20, recoveryLimit: 10 }).pipe(
 *     Effect.provide(WorkerLayer)
 *   )
 * }
 * ```
 */
export const drain = GroupWorker.drain
export { DrainResult } from "./internal/worker/Results.js"
export type { Options, QueueOptions, DrainLimits } from "./internal/worker/GroupWorker.js"

export {
  JobWorkerConfigurationError,
  JobWorkerNotReady,
  JobWorkerUnavailable
} from "./internal/worker/Capability.js"

/** Sealed execution capability captured by bounded drain and scoped polling. */
export interface JobWorkerService {
  readonly [WorkerCapability]: RuntimeCapability
}

/** Application-composed worker service; construction starts no execution. */
export class JobWorker extends Context.Service<JobWorker, JobWorkerService>()(
  "effect-jobs/JobWorker"
) {}

/** Captures a complete handler group and configures queue concurrency before use. */
export const make = GroupWorker.make

/** Construction is inert; drain and polling have explicit application-owned lifetimes. */
export const layer = <A extends JobApi<string, Groups>>(api: A, options: Options) =>
  Layer.effect(JobWorker, make(api, options))
