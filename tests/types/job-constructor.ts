import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Queue from "../../src/JobQueue.js"
import type { JobEnqueue } from "../../src/JobEnqueue.js"
import type { JobRegistry } from "../../src/JobRegistry.js"
import type { JobPayloadDecoder } from "../../src/JobContract.js"

class EncodeKeys extends Context.Service<EncodeKeys, {}>()(
  "tests/job-constructor/EncodeKeys"
) {}
class DecodeKeys extends Context.Service<DecodeKeys, {}>()(
  "tests/job-constructor/DecodeKeys"
) {}
class HandlerService extends Context.Service<HandlerService, {}>()(
  "tests/job-constructor/Handler"
) {}
declare const payload: Schema.Codec<
  { readonly total: number },
  string,
  DecodeKeys,
  EncodeKeys
>
declare const decode: JobPayloadDecoder
declare const version: 2 | undefined
declare const optionalPolicy: Policy.JobPolicy | undefined
const queue = Queue.make("billing")
const base = { name: "invoice.send", queue, payload } as const
export const explicitDefault = Job.make({
  ...base,
  version: 2,
  defaultPolicy: Policy.defaultPolicy
})
export const omittedDefault = Job.make({ ...base, defaultPolicy: Policy.defaultPolicy })
export const optionalVersionDefault = Job.make({
  ...base,
  version,
  defaultPolicy: Policy.defaultPolicy
})
export const explicitOptional = Job.make({
  ...base,
  version: 2,
  defaultPolicy: optionalPolicy
})
export const omittedOptional = Job.make(base)
export const optionalVersionOptional = Job.make({
  ...base,
  version,
  defaultPolicy: optionalPolicy
})

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Definition<
  V extends number,
  D extends Policy.JobPolicy | undefined
> = Job.JobDefinition<typeof payload, "invoice.send", V, "billing", D>
export type ExplicitDefault = Assert<
  Equal<
    typeof explicitDefault,
    Effect.Effect<Definition<2, Policy.JobPolicy>, Job.InvalidJobDefinition>
  >
>
export type OmittedDefault = Assert<
  Equal<
    typeof omittedDefault,
    Effect.Effect<Definition<1, Policy.JobPolicy>, Job.InvalidJobDefinition>
  >
>
export type OptionalVersionDefault = Assert<
  Equal<
    typeof optionalVersionDefault,
    Effect.Effect<Definition<1 | 2, Policy.JobPolicy>, Job.InvalidJobDefinition>
  >
>
export type ExplicitOptional = Assert<
  Equal<
    typeof explicitOptional,
    Effect.Effect<Definition<2, Policy.JobPolicy | undefined>, Job.InvalidJobDefinition>
  >
>
export type OmittedOptional = Assert<
  Equal<
    typeof omittedOptional,
    Effect.Effect<Definition<1, Policy.JobPolicy | undefined>, Job.InvalidJobDefinition>
  >
>
export type OptionalVersionOptional = Assert<
  Equal<
    typeof optionalVersionOptional,
    Effect.Effect<
      Definition<1 | 2, Policy.JobPolicy | undefined>,
      Job.InvalidJobDefinition
    >
  >
>
export type ConstructorError = Assert<
  Equal<Effect.Error<typeof explicitDefault>, Job.InvalidJobDefinition>
>
export type ConstructorServices = Assert<
  Equal<Effect.Services<typeof explicitDefault>, never>
>

export const setup = Effect.gen(function* () {
  const job = yield* omittedDefault
  const input = {
    producer: { operation: "invoice.create", operationId: "request-1", slot: "send" },
    payload: { total: 1 }
  }
  const enqueued = job.enqueue(input)
  const handler = job.handlerLayer(() => Effect.asVoid(HandlerService), decode)
  const noDefault = yield* omittedOptional
  // @ts-expect-error Policy is required when the default is absent.
  const missingPolicy = noDefault.enqueue(input)
  const maybeDefault = yield* explicitOptional
  // @ts-expect-error Policy is required when the default is optional.
  const optionalMissingPolicy = maybeDefault.enqueue(input)
  // @ts-expect-error Schema Type is the decoded domain, not the encoded string.
  const encodedPayload = job.enqueue({ ...input, payload: "persisted" })
  const maybeVersion = yield* optionalVersionDefault
  // @ts-expect-error Optional versions include the omitted default 1.
  const onlyTwo: 2 = maybeVersion.version
  // @ts-expect-error Catalog queue literal remains correlated with this definition.
  const anotherQueue: "mail" = job.catalog.queue
  // @ts-expect-error The definition remains immutable.
  job.name = "invoice.next"
  void onlyTwo
  void anotherQueue
  return { job, enqueued, handler, missingPolicy, optionalMissingPolicy, encodedPayload }
})

export type EnqueueServices = Assert<
  Equal<
    Effect.Services<Effect.Success<typeof setup>["enqueued"]>,
    JobEnqueue | EncodeKeys
  >
>
export type HandlerServices = Assert<
  Equal<
    Layer.Services<Effect.Success<typeof setup>["handler"]>,
    JobRegistry | DecodeKeys | HandlerService
  >
>
export type ConstructorNotInfallible = Assert<
  Equal<typeof omittedDefault extends Effect.Effect<unknown> ? true : false, false>
>
export type EnqueueNotClosed = Assert<
  Equal<
    Effect.Success<typeof setup>["enqueued"] extends Effect.Effect<unknown, never>
      ? true
      : false,
    false
  >
>
