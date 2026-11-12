import { Context, Effect, Schema } from "effect"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import type { JobEnqueueError, JobsTransaction } from "../../src/JobTransaction.js"
import type { JobEnqueue, JobPersistenceError } from "../../src/JobEnqueue.js"

class Keys extends Context.Service<Keys, {}>()("types/producer/Keys") {}
class Database extends Context.Service<Database, {}>()("types/producer/Database") {}

const empty = Effect.runSync(Producer.make("billing.empty"))
// @ts-expect-error An empty producer has no legal input.
export const emptyEnqueue = empty.enqueue({
  slot: "anything",
  operationId: "one",
  payload: "value"
})
// @ts-expect-error An empty producer has no legal input.
export const emptyStandalone = empty.enqueueStandalone({
  slot: "anything",
  operationId: "one",
  payload: "value"
})
// @ts-expect-error The record constructor is removed, not retained as an overload.
Effect.runSync(Producer.make({ operation: "old", slots: {} }))
// @ts-expect-error Slot replacement is intentionally not part of assembly.
export const removedReplacement = Producer.replaceSlot
declare const privatePayload: Schema.Codec<string, string, never, Keys>
declare const tx: JobsTransaction<"database-error", Database>
const queue = Queue.make("billing")
const producer = Effect.runSync(
  Producer.make("billing.issue").pipe(
    Producer.withSlot(
      "public",
      {
        name: "billing.public",
        version: 1,
        payload: Schema.Struct({ id: Schema.String })
      },
      { queue }
    ),
    Producer.withSlot(
      "private",
      { name: "billing.private", version: 1, payload: privatePayload },
      { queue }
    )
  )
)
export const ordinary: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobPersistenceError,
  JobEnqueue
> = producer.enqueue({ slot: "public", operationId: "one", payload: { id: "one" } })

export const operationLiteral: "billing.issue" = producer.operation
export const publicKind: "billing.public" = producer.slots.public.job.name
export const queueLiteral: "billing" = producer.slots.public.queue.name
export const resolvedDefault: Policy.JobPolicy = producer.slots.public.policy
Effect.succeed(producer).pipe(
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
export const withAnother = Effect.runSync(
  Effect.succeed(producer).pipe(
    Producer.withSlot(
      "number",
      { name: "billing.number", version: 1, payload: Schema.Finite },
      { queue }
    )
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
  policy: Policy.defaultPolicy
})
export const routedPrivate: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobPersistenceError,
  JobEnqueue | Keys
> = producer.enqueueStandalone({
  slot: "private",
  operationId: "one",
  payload: "private",
  // @ts-expect-error Fixed slots prohibit even a valid queue reference.
  queue: Queue.make("priority"),
  policy: Policy.defaultPolicy
})
export const routedExplicit = producer.enqueueInTransaction(tx, {
  slot: "private",
  operationId: "one",
  payload: "private",
  // @ts-expect-error Fixed slots prohibit even a valid queue reference.
  queue: Queue.make("priority"),
  policy: Policy.defaultPolicy
})
export const wrongQueue = producer.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Fixed slots prohibit routing fields.
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
  job: { name: "other", version: 1, payload: Schema.String }
})

const priority = Queue.make("priority")
export const choices = [queue, priority] as const
const mixed = Effect.runSync(
  Effect.succeed(producer).pipe(
    Producer.withSlot(
      "choose",
      { name: "billing.choice", version: 1, payload: privatePayload },
      { queues: choices }
    ),
    Producer.withSlot(
      "singleton",
      { name: "billing.single", version: 1, payload: Schema.Finite },
      { queues: [queue] }
    )
  )
)
Producer.withSlot("inline", producer.slots.public.job, { queues: [queue, priority] })
// @ts-expect-error Routing declarations are mutually exclusive.
Producer.withSlot("both", producer.slots.public.job, { queue, queues: choices })
// @ts-expect-error Empty choices cannot supply a selection.
Producer.withSlot("empty", producer.slots.public.job, { queues: [] })
Producer.withSlot("default", producer.slots.public.job, {
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queues: choices,
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  defaultQueue: queue
})
export const selected: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobPersistenceError,
  JobEnqueue | Keys
> = mixed.enqueue({
  slot: "choose",
  operationId: "one",
  payload: "private",
  queue: "priority"
})
export const selectedExplicit: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | "database-error",
  Database | Keys
> = mixed.enqueueInTransaction(tx, {
  slot: "choose",
  operationId: "one",
  payload: "private",
  queue: "billing",
  policy: Policy.defaultPolicy,
  availableAt: 1
})
export const generic = <K extends keyof typeof mixed.slots>(
  input: Producer.Input<typeof mixed.slots, K> & { readonly slot: K }
) => mixed.enqueue(input)
declare const correlated: Producer.Input<typeof mixed.slots>
export const routeCase1 = mixed.enqueue(correlated)
export const routeCase2 = mixed.enqueueStandalone(correlated)
export const routeCase3 = mixed.enqueueInTransaction(tx, correlated)
declare const bareSlot: "public" | "choose"
// @ts-expect-error A union slot without correlated routing/payload is unsafe.
export const routeCase4 = mixed.enqueue({
  slot: bareSlot,
  operationId: "one",
  payload: "private",
  queue: "priority"
})

export const routeCase5 = mixed.enqueue({
  operationId: "one",
  slot: "choose",
  payload: "private",
  queue: "priority",
  policy: Policy.defaultPolicy
})
export const routeCase6 = mixed.enqueue({
  operationId: "one",
  slot: "singleton",
  payload: 1,
  queue: "billing"
})
export const routeCase7 = mixed.enqueue({
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "billing"
})
// @ts-expect-error Fixed queue undefined is forbidden.
export const routeCase8 = mixed.enqueue({
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  queue: undefined
})
// @ts-expect-error Choice is required.
export const routeCase9 = mixed.enqueue({
  operationId: "one",
  slot: "choose",
  payload: "private"
})
// @ts-expect-error Singleton still needs a choice.
export const routeCase10 = mixed.enqueue({
  operationId: "one",
  slot: "singleton",
  payload: 1
})
export const routeCase11 = mixed.enqueue({
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "other"
})
export const routeCase12 = mixed.enqueue({
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: priority
})
export const routeCase13 = mixed.enqueue({
  operationId: "one",
  slot: "choose",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  payload: { id: "one" },
  queue: "priority"
})
export const routeCase14 = mixed.enqueue({
  operationId: "one",
  slot: "singleton",
  payload: 1,
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "priority"
})

export const routeCase15 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "choose",
  payload: "private",
  queue: "priority",
  policy: Policy.defaultPolicy
})
export const routeCase16 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "singleton",
  payload: 1,
  queue: "billing"
})
export const routeCase17 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "billing"
})
// @ts-expect-error Fixed queue undefined is forbidden.
export const routeCase18 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  queue: undefined
})
// @ts-expect-error Choice is required.
export const routeCase19 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "choose",
  payload: "private"
})
// @ts-expect-error Singleton still needs a choice.
export const routeCase20 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "singleton",
  payload: 1
})
export const routeCase21 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "other"
})
export const routeCase22 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: priority
})
export const routeCase23 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "choose",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  payload: { id: "one" },
  queue: "priority"
})
export const routeCase24 = mixed.enqueueStandalone({
  operationId: "one",
  slot: "singleton",
  payload: 1,
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "priority"
})

export const routeCase25 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "choose",
  payload: "private",
  queue: "priority",
  policy: Policy.defaultPolicy
})
export const routeCase26 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "singleton",
  payload: 1,
  queue: "billing"
})
export const routeCase27 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "billing"
})
// @ts-expect-error Fixed queue undefined is forbidden.
export const routeCase28 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "public",
  payload: { id: "one" },
  queue: undefined
})
// @ts-expect-error Choice is required.
export const routeCase29 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "choose",
  payload: "private"
})
// @ts-expect-error Singleton still needs a choice.
export const routeCase30 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "singleton",
  payload: 1
})
export const routeCase31 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "other"
})
export const routeCase32 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "choose",
  payload: "private",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: priority
})
export const routeCase33 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "choose",
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  payload: { id: "one" },
  queue: "priority"
})
export const routeCase34 = mixed.enqueueInTransaction(tx, {
  operationId: "one",
  slot: "singleton",
  payload: 1,
  // @ts-expect-error Per-slot routing and payload must remain correlated.
  queue: "priority"
})

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const exactSelectedServices: Equal<
  Effect.Services<typeof selected>,
  JobEnqueue | Keys
> = true
export const exactExplicitServices: Equal<
  Effect.Services<typeof selectedExplicit>,
  Database | Keys
> = true
export const exactExplicitErrors: Equal<
  Effect.Error<typeof selectedExplicit>,
  JobEnqueueError | "database-error"
> = true
export const genericStandalone = <K extends keyof typeof mixed.slots>(
  input: Producer.Input<typeof mixed.slots, K> & { readonly slot: K }
) => mixed.enqueueStandalone(input)
export const genericExplicit = <E, R, K extends keyof typeof mixed.slots>(
  transaction: JobsTransaction<E, R>,
  input: Producer.Input<typeof mixed.slots, K> & { readonly slot: K }
) => mixed.enqueueInTransaction(transaction, input)
export const sameObjectenqueue = mixed.enqueue({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Even the exact fixed queue object is forbidden.
  queue
})
export const sameObjectenqueueStandalone = mixed.enqueueStandalone({
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Even the exact fixed queue object is forbidden.
  queue
})
export const sameObjectenqueueInTransaction = mixed.enqueueInTransaction(tx, {
  slot: "public",
  operationId: "one",
  payload: { id: "one" },
  // @ts-expect-error Even the exact fixed queue object is forbidden.
  queue
})
