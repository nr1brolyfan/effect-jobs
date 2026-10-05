import { Data, Schema } from "effect"
import { QueueName } from "./JobIdentity.js"

const JobQueueTypeId: unique symbol = Symbol("effect-jobs/JobQueue")

export interface JobQueue<Name extends string = string> {
  readonly [JobQueueTypeId]: typeof JobQueueTypeId
  readonly name: Name
}

export class InvalidJobQueue extends Data.TaggedError("InvalidJobQueue")<{
  readonly expected: string
}> {}

/** Logical configuration only; creates no storage or worker. */
export const make = <const Name extends string>(name: Name): JobQueue<Name> => {
  if (!Schema.is(QueueName)(name)) {
    throw new InvalidJobQueue({
      expected: "1–64 ASCII characters matching ^[a-z][a-z0-9.-]*$"
    })
  }
  const queue: JobQueue<Name> = { [JobQueueTypeId]: JobQueueTypeId, name }
  return Object.freeze(queue)
}
