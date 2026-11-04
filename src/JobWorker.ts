/** Worker service and construction. Execution remains explicit and scoped. */
import { Context, Layer } from "effect"
import type { JobGroup, Definitions } from "./JobGroup.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import type { RuntimeCapability } from "./internal/worker/Capability.js"
import * as GroupWorker from "./internal/worker/GroupWorker.js"
import type { Storage, Options } from "./internal/worker/GroupWorker.js"

/**
 * Runs bounded recovery and claims with concurrency fixed at worker construction.
 * Idle observes an empty claim; MoreWork reaches the run limit; Backoff requests
 * delayed retry after storage uncertainty. None promises exactly-once effects.
 *
 * @example
 * ```ts
 * import { Effect, Layer, Schema } from "effect"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Group from "effect-jobs/JobGroup"
 * import * as Worker from "effect-jobs/JobWorker"
 * import type { Storage } from "effect-jobs/JobWorker"
 *
 * const queue = Queue.make("billing")
 * const group = Group.make("billing", {
 *   invoice: { kind: "invoice.generate", version: 1,
 *     payload: Schema.Struct({ invoiceId: Schema.String }) }
 * })
 * // Application supplies qualified storage; construction starts no activity.
 * const runOnce = <E, R>(storage: Storage<E, R>) => {
 *   const HandlerLayer = group.toLayer({ invoice: () => Effect.void })
 *   const WorkerLayer = Worker.layer(group, storage, {
 *     queues: [{ queue, concurrency: 2 }]
 *   }).pipe(Layer.provide(HandlerLayer))
 *   return Worker.drain(queue, { maxJobs: 20, recoveryLimit: 10 }).pipe(
 *     Effect.provide(WorkerLayer)
 *   )
 * }
 * ```
 */
export const drain = GroupWorker.drain
export { DrainResult } from "./internal/worker/Results.js"
export type {
  Storage,
  Options,
  QueueOptions,
  DrainLimits
} from "./internal/worker/GroupWorker.js"

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
export const layer = <Name extends string, D extends Definitions, E, R>(
  group: JobGroup<Name, D>,
  storage: Storage<E, R>,
  options: Options
) => Layer.effect(JobWorker, make(group, storage, options))
