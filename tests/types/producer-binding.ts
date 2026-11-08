import { Context, Effect, Schema } from "effect"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import type { JobEnqueueError, JobsTransaction } from "../../src/JobTransaction.js"
import type { JobEnqueue, JobBackendError } from "../../src/JobEnqueue.js"

class Keys extends Context.Service<Keys, {}>()("types/producer/Keys") {}
class Database extends Context.Service<Database, {}>()("types/producer/Database") {}

const empty = Producer.make("billing.empty")
export const emptyEnqueue = empty.enqueue({
  // @ts-expect-error An empty producer has no legal slot.
  slot: "anything",
  operationId: "one",
  // @ts-expect-error An empty producer has no payload contract.
  payload: "value"
})
export const emptyStandalone = empty.enqueueStandalone({
  // @ts-expect-error Empty standalone cannot enqueue any slot either.
  slot: "anything",
  operationId: "one",
  // @ts-expect-error An empty producer has no payload contract.
  payload: "value"
})
// @ts-expect-error The record constructor is removed, not retained as an overload.
Producer.make({ operation: "old", slots: {} })
// @ts-expect-error Slot replacement is intentionally not part of assembly.
export const removedReplacement = Producer.replaceSlot
declare const privatePayload: Schema.Codec<string, string, never, Keys>
declare const tx: JobsTransaction<"database-error", Database>
const queue = Queue.make("billing")
const producer = Producer.make("billing.issue").pipe(
  Producer.withSlot(
    "public",
    {
      kind: "billing.public",
      version: 1,
      payload: Schema.Struct({ id: Schema.String })
    },
    { queue }
  ),
  Producer.withSlot(
    "private",
    { kind: "billing.private", version: 1, payload: privatePayload },
    { queue }
  )
)
export const ordinary: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobBackendError,
  JobEnqueue
> = producer.enqueue({ slot: "public", operationId: "one", payload: { id: "one" } })

export const operationLiteral: "billing.issue" = producer.operation
export const publicKind: "billing.public" = producer.slots.public.job.kind
export const queueLiteral: "billing" = producer.slots.public.queue.name
export const resolvedDefault: Policy.JobPolicy = producer.slots.public.policy
producer.pipe(
  // @ts-expect-error Known duplicate slot names are rejected during assembly.
  Producer.withSlot("public", producer.slots.public.job, { queue })
)
// @ts-expect-error withSlot requires a default queue.
Producer.withSlot("missing", producer.slots.public.job, {})
Producer.withSlot("bad-policy", producer.slots.public.job, {
  queue,
  // @ts-expect-error A slot policy is resolved, not a partial patch.
  policy: { maxFinalizedAttempts: 4 }
})
export const withAnother = producer.pipe(
  Producer.withSlot(
    "number",
    { kind: "billing.number", version: 1, payload: Schema.Finite },
    { queue }
  )
)
export const numberEnqueue = withAnother.enqueue({
  slot: "number",
  operationId: "one",
  payload: 1
})
export const wrongNumber = withAnother.enqueue({
  slot: "number",
  operationId: "one",
  // @ts-expect-error Later slots retain their own payload type.
  payload: "not a number"
})
export const wrongEarlier = withAnother.enqueue({
  slot: "public",
  operationId: "one",
  // @ts-expect-error Earlier payload types are not widened by adding another slot.
  payload: 1
})
export const encrypted = producer.enqueue({
  slot: "private",
  operationId: "one",
  payload: "private"
})
export const explicit: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | "database-error",
  Keys | Database
> = producer.enqueueInTransaction(tx, {
  slot: "private",
  operationId: "one",
  payload: "private"
})
type ExpectFalse<T extends false> = T
export type EncryptionIsRequired = ExpectFalse<
  typeof encrypted extends Effect.Effect<EnqueueResult, unknown, JobEnqueue>
    ? true
    : false
>
export const wrongPayload = producer.enqueue({
  slot: "public",
  operationId: "one",
  // @ts-expect-error Payload cannot widen the inferred slot to another binding.
  payload: "private"
})
export const unknownSlot = producer.enqueue({
  // @ts-expect-error Unknown slots are not valid consequences.
  slot: "absent",
  operationId: "one",
  payload: { id: "one" }
})
export const changedQueue = producer.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  queue,
  policy: Policy.defaultPolicy
})
export const routedPrivate: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobBackendError,
  JobEnqueue | Keys
> = producer.enqueueStandalone({
  slot: "private",
  operationId: "one",
  payload: "private",
  queue: Queue.make("priority"),
  policy: Policy.defaultPolicy
})
export const routedExplicit = producer.enqueueInTransaction(tx, {
  slot: "private",
  operationId: "one",
  payload: "private",
  queue: Queue.make("priority"),
  policy: Policy.defaultPolicy
})
export const wrongQueue = producer.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Routing accepts a declared queue, not a raw string.
  queue: "priority"
})
export const partialPolicy = producer.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Override is a complete resolved policy, not a partial merge.
  policy: { maxFinalizedAttempts: 5 }
})
export const changedContract = producer.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Contract identity remains bound to the slot.
  job: { kind: "other", version: 1, payload: Schema.String }
})
