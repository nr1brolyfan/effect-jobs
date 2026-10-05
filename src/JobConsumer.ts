import { Data, Effect, Schema } from "effect"
import type { JobQueue } from "./JobQueue.js"

const ConsumerOptions = Schema.Struct({
  localConcurrency: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 64 }))
  ),
  claimLimitPerRun: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
  ),
  recoveryLimitPerRun: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
  )
})

export interface JobConsumer<Q extends JobQueue = JobQueue> extends ConsumerOptions {
  readonly queue: Q
}
type ConsumerOptions = typeof ConsumerOptions.Type

export class InvalidJobConsumer extends Data.TaggedError("InvalidJobConsumer")<{
  readonly reason: "invalid-options"
}> {}
export class DuplicateJobConsumer extends Data.TaggedError("DuplicateJobConsumer")<{
  readonly queue: string
}> {
  override get message(): string {
    return `Duplicate consumer for ${this.queue}; configure one consumer per logical queue`
  }
}

/** Bounded configuration, not a running worker. */
export const make = <Q extends JobQueue>(
  queue: Q,
  options: ConsumerOptions
): Effect.Effect<JobConsumer<Q>, InvalidJobConsumer> =>
  Schema.decodeEffect(ConsumerOptions)(options, { onExcessProperty: "error" }).pipe(
    Effect.map((decoded) => Object.freeze({ queue, ...decoded })),
    Effect.mapError(() => new InvalidJobConsumer({ reason: "invalid-options" }))
  )

export interface JobPlan<
  Consumers extends ReadonlyArray<JobConsumer> = ReadonlyArray<JobConsumer>
> {
  readonly consumers: Readonly<Consumers>
}

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
