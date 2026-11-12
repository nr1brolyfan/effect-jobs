import { Context, Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Producer from "../../src/JobProducer.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import type { JobEnqueueError } from "../../src/JobTransaction.js"
import type { JobPersistenceError } from "../../src/JobEnqueue.js"
import type { JobEnqueue } from "../../src/JobEnqueue.js"

class Encoding extends Context.Service<Encoding, {}>()("types/Encoding") {}
declare const schema: Schema.Codec<{ readonly total: number }, string, never, Encoding>
const queue = Queue.make("billing")
const required = Effect.runSync(Job.make({ name: "invoice.generate", payload: schema }))
const defaulted = Effect.runSync(
  Job.make({
    name: "invoice.send",
    payload: Schema.Struct({ recipient: Schema.String })
  })
)
const dynamic = Effect.runSync(
  Job.make({
    name: "invoice.dynamic",
    payload: Schema.String
  })
)
const producer = Effect.runSync(
  Producer.make("invoice.create").pipe(
    Producer.withSlot("generate", required, { queue }),
    Producer.withSlot("delivery", defaulted, {
      queue: Queue.make("mail"),
      policy: Policy.defaultPolicy
    }),
    Producer.withSlot("copy", defaulted, { queue: Queue.make("mail") }),
    Producer.withSlot("dynamic", dynamic, { queue })
  )
)
const bound = producer.enqueue({
  slot: "generate",
  operationId: "one",
  payload: { total: 1 },
  policy: Policy.defaultPolicy
})
const services: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobPersistenceError,
  Encoding | JobEnqueue
> = bound
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type EncodingIsPreserved = Assert<
  Equal<Effect.Services<typeof bound>, Encoding | JobEnqueue>
>
export const case1 = producer.enqueue({
  // @ts-expect-error unknown slot
  slot: "unknown",
  operationId: "one",
  payload: { total: 1 }
})
export const case2 = producer.enqueue({
  slot: "delivery",
  operationId: "one",
  // @ts-expect-error selected payload must match the bound job
  payload: { total: 1 }
})
// A binding resolves a default policy, so policy omission is legal.
export const case3 = producer.enqueue({
  slot: "generate",
  operationId: "one",
  payload: { total: 1 }
})
// Optional producer policy overrides do not make policy required.
export const case4 = producer.enqueue({
  slot: "dynamic",
  operationId: "one",
  payload: "input"
})
export const case5 = producer.enqueue({
  slot: "delivery",
  operationId: "one",
  payload: { recipient: "synthetic" }
})
export const case6 = producer.enqueue({
  slot: "copy",
  operationId: "one",
  payload: { recipient: "other" },
  policy: Policy.defaultPolicy
})
export const case7 = producer.enqueue({
  slot: "delivery",
  operationId: "one",
  payload: { recipient: "synthetic" },
  // @ts-expect-error an override is complete, never a partial merge
  policy: { maxFinalizedAttempts: 2 }
})
declare const uncertainSlot: "generate" | "delivery"
// @ts-expect-error union slots must not decouple payload/policy from the runtime selection
export const case8 = producer.enqueue({
  slot: uncertainSlot,
  operationId: "one",
  payload: { recipient: "synthetic" }
})
// @ts-expect-error Pure contracts expose no job-level ambient entrypoint
export const case9 = required.enqueue({
  producer: { operation: "invoice.create", operationId: "one", slot: "generate" },
  payload: { total: 1 }
})
// @ts-expect-error Pure contracts expose no standalone entrypoint
export const case10 = dynamic.enqueueStandalone({
  producer: { operation: "invoice.create", operationId: "one", slot: "dynamic" },
  payload: "input"
})
// @ts-expect-error deprecated kind constructor is absent
Effect.runSync(Job.make({ kind: "old", payload: Schema.String }))
void services

const optionalOptions = Effect.runSync(
  Job.make({
    name: "optional.options",
    payload: Schema.String
  })
)
// @ts-expect-error Pure contracts expose no production methods
export const optionalOptionsMissingPolicy = optionalOptions.enqueue({
  producer: { operation: "invoice.create", operationId: "one", slot: "dynamic" },
  payload: "input"
})
