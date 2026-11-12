import { Context, Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
class Encoding extends Context.Service<Encoding, {}>()("types/contract/Encoding") {}
class Decoding extends Context.Service<Decoding, {}>()("types/contract/Decoding") {}
declare const payload: Schema.Codec<
  { readonly total: number },
  string,
  Decoding,
  Encoding
>
declare const version: 2 | undefined
export const explicit = Job.make({ name: "invoice.send", version: 2, payload })
export const omitted = Job.make({ name: "invoice.send", payload })
export const optional = Job.make({ name: "invoice.send", version, payload })
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type Explicit = Assert<
  Equal<
    typeof explicit,
    Effect.Effect<
      Job.JobDefinition<typeof payload, "invoice.send", 2>,
      Job.InvalidJobDefinition
    >
  >
>
export type Omitted = Assert<
  Equal<
    Effect.Success<typeof omitted>,
    Job.JobDefinition<typeof payload, "invoice.send", 1>
  >
>
export type Optional = Assert<
  Equal<
    Effect.Success<typeof optional>,
    Job.JobDefinition<typeof payload, "invoice.send", 1 | 2>
  >
>
export type Services = Assert<Equal<Effect.Services<typeof explicit>, never>>
// @ts-expect-error Constructor must execute before exposing its contract.
export const eager = explicit.name
export const resolved = Effect.runSync(explicit)
// @ts-expect-error Contracts contain no routing.
export const removedQueue = resolved.queue
// @ts-expect-error Contracts contain no policy.
export const removedPolicy = resolved.defaultPolicy
// @ts-expect-error Production belongs to Producer.
export const removedEnqueue = resolved.enqueue
// @ts-expect-error Contracts remain immutable.
resolved.name = "different"
// @ts-expect-error Historical public kind spelling is absent.
export const invalidKind = Job.make({ kind: "old", payload })
// @ts-expect-error Routing is not a contract constructor option.
export const invalidQueue = Job.make({ name: "invoice.send", payload, queue: "billing" })
