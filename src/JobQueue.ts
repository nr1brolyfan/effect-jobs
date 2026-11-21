/**
 * Declares logical queues independently of storage and worker startup.
 */
import { Data, Effect, Schema } from "effect"
import { QueueName } from "./JobIdentity.js"

const JobQueueTypeId: unique symbol = Symbol("effect-jobs/JobQueue")

/**
 * Logical queue identity; Name preserves the declaration literal.
 *
 * @category models
 */
export interface JobQueue<Name extends string = string> {
  readonly [JobQueueTypeId]: typeof JobQueueTypeId
  readonly name: Name
}

/**
 * Typed setup failure when the queue name violates QueueName.
 *
 * @category errors
 */
export class InvalidJobQueue extends Data.TaggedError("InvalidJobQueue")<{
  readonly expected: string
}> {}

/**
 * Creates a frozen logical queue. Names are 1–64 ASCII characters matching
 * ^[a-z][a-z0-9.-]*$; invalid names fail with InvalidJobQueue. Creates no storage or worker.
 *
 * @category constructors
 */
export const make = <const Name extends string>(
  name: Name
): Effect.Effect<JobQueue<Name>, InvalidJobQueue> =>
  Effect.gen(function* () {
    if (!Schema.is(QueueName)(name)) {
      return yield* new InvalidJobQueue({
        expected: "1–64 ASCII characters matching ^[a-z][a-z0-9.-]*$"
      })
    }
    const queue: JobQueue<Name> = { [JobQueueTypeId]: JobQueueTypeId, name }
    return Object.freeze(queue)
  })
