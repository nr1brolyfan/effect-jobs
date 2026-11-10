import { Context, Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Producer from "../../src/JobProducer.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import type { JobEnqueueError } from "../../src/JobTransaction.js"
import type { JobBackendError } from "../../src/JobEnqueue.js"
import type { JobEnqueue } from "../../src/JobEnqueue.js"

class Encoding extends Context.Service<Encoding, {}>()("types/Encoding") {}
declare const schema: Schema.Codec<{ readonly total: number }, string, never, Encoding>
const queue = Queue.make("billing")
const required = Job.make({ name: "invoice.generate", queue, payload: schema })
const defaulted = Job.make({
  name: "invoice.send",
  queue: Queue.make("mail"),
  payload: Schema.Struct({ recipient: Schema.String }),
  defaultPolicy: Policy.defaultPolicy
})
declare const optionalDefault: Policy.JobPolicy | undefined
const dynamic = Job.make({
  name: "invoice.dynamic",
  queue,
  payload: Schema.String,
  defaultPolicy: optionalDefault
})
const producer = Producer.make({
  operation: "invoice.create",
  slots: { generate: required, delivery: defaulted, copy: defaulted, dynamic }
})
const bound = producer.enqueue("generate", {
  operationId: "one",
  payload: { total: 1 },
  policy: Policy.defaultPolicy
})
const services: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobBackendError,
  Encoding | JobEnqueue
> = bound
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type EncodingIsPreserved = Assert<
  Equal<Effect.Services<typeof bound>, Encoding | JobEnqueue>
>
// @ts-expect-error unknown slot
export const case1 = producer.enqueue("unknown", { operationId: "one", payload: {} })
// @ts-expect-error selected payload must match the bound job
export const case2 = producer.enqueue("delivery", {
  operationId: "one",
  payload: { total: 1 }
})
// @ts-expect-error a definition without a default still requires policy
export const case3 = producer.enqueue("generate", {
  operationId: "one",
  payload: { total: 1 }
})
// @ts-expect-error optional defaults remain conservative
export const case4 = producer.enqueue("dynamic", { operationId: "one", payload: "input" })
export const case5 = producer.enqueue("delivery", {
  operationId: "one",
  payload: { recipient: "synthetic" }
})
export const case6 = producer.enqueue("copy", {
  operationId: "one",
  payload: { recipient: "other" },
  policy: Policy.defaultPolicy
})
// @ts-expect-error an override is complete, never a partial merge
export const case7 = producer.enqueue("delivery", {
  operationId: "one",
  payload: { recipient: "synthetic" },
  policy: { maxAttempts: 2 }
})
declare const uncertainSlot: "generate" | "delivery"
// @ts-expect-error union slots must not decouple payload/policy from the runtime selection
export const case8 = producer.enqueue(uncertainSlot, {
  operationId: "one",
  payload: { recipient: "synthetic" }
})
// @ts-expect-error missing default requires policy on the job-level ambient entrypoint
export const case9 = required.enqueue({
  producer: producer.identity({ operationId: "one", slot: "generate" }),
  payload: { total: 1 }
})
// @ts-expect-error dynamic default must not promise policy omission
export const case10 = dynamic.enqueueStandalone({
  producer: producer.identity({ operationId: "one", slot: "dynamic" }),
  payload: "input"
})
// @ts-expect-error deprecated kind constructor is absent
Job.make({ kind: "old", queue, payload: Schema.String })
void services

declare const maybeOptions: { readonly defaultPolicy?: Policy.JobPolicy }
const optionalOptions = Job.make({
  name: "optional.options",
  queue,
  payload: Schema.String,
  ...maybeOptions
})
// @ts-expect-error optional property cannot promise runtime presence
export const optionalOptionsMissingPolicy = optionalOptions.enqueue({
  producer: producer.identity({ operationId: "one", slot: "dynamic" }),
  payload: "input"
})
