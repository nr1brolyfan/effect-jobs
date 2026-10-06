/**
 * Declares logical queues independently of storage and worker startup.
 */
import { Data, Schema } from "effect"
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
 * Thrown synchronously when the queue name violates QueueName.
 *
 * @category errors
 */
export class InvalidJobQueue extends Data.TaggedError("InvalidJobQueue")<{
  readonly expected: string
}> {}

/**
 * Creates a frozen logical queue. Names are 1–64 ASCII characters matching
 * ^[a-z][a-z0-9.-]*$; invalid names throw InvalidJobQueue. Creates no storage or worker.
 *
 * @category constructors
 */
export const make = <const Name extends string>(name: Name): JobQueue<Name> => {
  if (!Schema.is(QueueName)(name)) {
    throw new InvalidJobQueue({
      expected: "1–64 ASCII characters matching ^[a-z][a-z0-9.-]*$"
    })
  }
  const queue: JobQueue<Name> = { [JobQueueTypeId]: JobQueueTypeId, name }
  return Object.freeze(queue)
}
