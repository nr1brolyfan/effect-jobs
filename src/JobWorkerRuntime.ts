/**
 * Runs explicit finite drains against an application-composed worker.
 */
import { drainWithOptions } from "./internal/worker/Drain.js"
import type { JobConsumer } from "./JobConsumer.js"

/** Tagged constructors and matchers for Idle, MoreWork and Backoff drain results. */
export { DrainResults } from "./internal/worker/Results.js"
/** Finite-drain observation; counts do not promise handler success or durable completion. */
export type { DrainResult } from "./internal/worker/Results.js"

/**
 * Runs bounded recovery and claims, acquiring local permits before claiming.
 * Requires JobWorker; waits for scoped executions and shares per-queue permits
 * across concurrent drains of that worker. Idle means an empty claim was observed;
 * MoreWork means the claim limit was reached; Backoff requests delayed retry after
 * claim/recovery/reconciliation uncertainty. None promises exactly-once effects.
 *
 * @example
 * ```ts
 * import { Effect, Layer, Schema } from "effect"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Job from "effect-jobs/Job"
 * import * as Codec from "effect-jobs/JobPayloadCodec"
 * import * as Registry from "effect-jobs/JobRegistry"
 * import * as Consumer from "effect-jobs/JobConsumer"
 * import * as Worker from "effect-jobs/JobWorker"
 * import * as Runtime from "effect-jobs/JobWorkerRuntime"
 * import type { JobStoreService } from "effect-jobs/JobStore"
 *
 * const queue = Queue.make("billing")
 * const definition = Job.make({
 *   queue, kind: "invoice.generate", version: 1,
 *   payload: Schema.Struct({ invoiceId: Schema.String }),
 *   encodePayload: Codec.encodeJobPayload
 * })
 * // Application supplies its qualified store; this function does not create storage.
 * const runOnce = <E, R>(store: JobStoreService<E, R>) => {
 *   // Replace the no-op with application work; delivery is at-least-once.
 *   const HandlerLayer = definition.handlerLayer(() => Effect.void, Codec.decodeJobPayload)
 *   const WorkerLayer = Worker.layer(store, {
 *     catalog: [definition], operationResponseBudgetMillis: 100
 *   }).pipe(Layer.provide(HandlerLayer), Layer.provide(Registry.layer))
 *   return Consumer.make(queue, {
 *     localConcurrency: 2, claimLimitPerRun: 20, recoveryLimitPerRun: 10
 *   }).pipe(Effect.flatMap(Runtime.drain), Effect.provide(WorkerLayer))
 * }
 * ```
 *
 * @category operations
 */
export const drain = (consumer: JobConsumer) => drainWithOptions(consumer)
