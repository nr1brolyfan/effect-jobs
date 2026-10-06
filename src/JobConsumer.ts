/**
 * Configures bounded queue consumption and explicit multi-queue plans.
 */
import { Data, Effect, Schema } from "effect"
import type { JobQueue } from "./JobQueue.js"

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
type ConsumerOptions = typeof ConsumerOptions.Type

/**
 * Typed configuration failure for invalid bounds or excess option keys.
 *
 * @category errors
 */
export class InvalidJobConsumer extends Data.TaggedError("InvalidJobConsumer")<{
  readonly reason: "invalid-options"
}> {}
/**
 * Typed plan failure when multiple consumers name the same logical queue.
 *
 * @category errors
 */
export class DuplicateJobConsumer extends Data.TaggedError("DuplicateJobConsumer")<{
  readonly queue: string
}> {
  override get message(): string {
    return `Duplicate consumer for ${this.queue}; configure one consumer per logical queue`
  }
}

/**
 * Validates localConcurrency (1–64) and claim/recovery limits (1–10,000).
 * Returns an Effect failing with InvalidJobConsumer; starts no work.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Consumer from "effect-jobs/JobConsumer"
 *
 * const plan = Effect.gen(function* () {
 *   const consumer = yield* Consumer.make(Queue.make("billing"), {
 *     localConcurrency: 2,
 *     claimLimitPerRun: 20,
 *     recoveryLimitPerRun: 10
 *   })
 *   return yield* Consumer.plan(consumer)
 * })
 * ```
 *
 * @category constructors
 */
export const make = <Q extends JobQueue>(
  queue: Q,
  options: ConsumerOptions
): Effect.Effect<JobConsumer<Q>, InvalidJobConsumer> =>
  Schema.decodeEffect(ConsumerOptions)(options, { onExcessProperty: "error" }).pipe(
    Effect.map((decoded) => Object.freeze({ queue, ...decoded })),
    Effect.mapError(() => new InvalidJobConsumer({ reason: "invalid-options" }))
  )

/**
 * Explicit consumer list for scoped polling; one consumer per logical queue.
 *
 * @category models
 */
export interface JobPlan<
  Consumers extends ReadonlyArray<JobConsumer> = ReadonlyArray<JobConsumer>
> {
  readonly consumers: Readonly<Consumers>
}

/**
 * Copies and freezes the consumer list, preserving tuple types. Duplicate queue names
 * fail with DuplicateJobConsumer when the Effect runs; starts no work.
 *
 * @category operations
 */
export const plan = <const Consumers extends ReadonlyArray<JobConsumer>>(
  ...consumers: Consumers
): Effect.Effect<JobPlan<Consumers>, DuplicateJobConsumer> =>
  Effect.suspend(() => {
    const queues = new Set<string>()
    for (const consumer of consumers) {
      if (queues.has(consumer.queue.name)) {
        return Effect.fail(new DuplicateJobConsumer({ queue: consumer.queue.name }))
      }
      queues.add(consumer.queue.name)
    }
    return Effect.succeed(
      Object.freeze({
        consumers: Object.freeze([...consumers]) as unknown as Readonly<Consumers>
      })
    )
  })
