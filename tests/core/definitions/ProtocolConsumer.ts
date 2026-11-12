/** Test-only run configuration for direct protocol fixtures.
 * Public callers configure concurrency on JobWorker and pass limits to drain. */
import { Effect, Schema } from "effect"
import type { JobQueue } from "../../../src/JobQueue.js"

type ConsumerOptions = typeof ConsumerOptions.Type
const ConsumerOptions = Schema.Struct({
  /** Shared per-worker queue permits, acquired before claim; integer 1–64. */
  localConcurrency: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 64 }))
  ),
  /** Maximum started claims in one finite drain; integer 1–10,000. */
  claimLimitPerRun: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
  ),
  /** Maximum rows considered for expiry recovery per drain; integer 1–10,000. */
  recoveryLimitPerRun: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
  )
})

/**
 * Per-run limits and local concurrency for one logical queue; not a running worker.
 *
 * @category models
 */
export interface JobConsumer<Q extends JobQueue = JobQueue> extends ConsumerOptions {
  readonly queue: Q
}

/**
 * Fixture assembly only. Native Schema errors identify malformed test setup;
 * actual public validation is exercised by GroupWorker tests.
 */
export const make = <Q extends JobQueue>(queue: Q, options: ConsumerOptions) =>
  Schema.decodeEffect(ConsumerOptions)(options, { onExcessProperty: "error" }).pipe(
    Effect.map((decoded): JobConsumer<Q> => Object.freeze({ queue, ...decoded }))
  )
