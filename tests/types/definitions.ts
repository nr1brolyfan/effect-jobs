import * as FailureCodes from "../../src/FailureCode.js"
import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as JobConsumer from "../../src/JobConsumer.js"
import * as JobProducer from "../../src/JobProducer.js"
import * as JobQueue from "../../src/JobQueue.js"
import * as JobRegistry from "../../src/JobRegistry.js"
import type {
  JobPayloadEncoder,
  JobPayloadDecoder,
  EnqueueResult
} from "../../src/JobContract.js"
import { JobFailures } from "../../src/JobFailure.js"
import type { JobFailure } from "../../src/JobFailure.js"
import * as JobPolicy from "../../src/JobPolicy.js"
import type { JobsTransaction, JobEnqueueError } from "../../src/JobTransaction.js"

export class EncodeService extends Context.Service<EncodeService, {}>()(
  "tests/definitions/Encode"
) {}
export class DecodeService extends Context.Service<DecodeService, {}>()(
  "tests/definitions/Decode"
) {}
export class HandlerService extends Context.Service<HandlerService, {}>()(
  "tests/definitions/Handler"
) {}
export class BackendService extends Context.Service<BackendService, {}>()(
  "tests/definitions/Backend"
) {}
declare const encode: JobPayloadEncoder
declare const decode: JobPayloadDecoder
declare const schema: Schema.Codec<
  { readonly amount: number },
  string,
  DecodeService,
  EncodeService
>
declare const tx: JobsTransaction<"backend-error", BackendService>
declare const appId: string & { readonly AppId: unique symbol }

export const queue = JobQueue.make("billing")
export const producer = JobProducer.make({
  operation: "billing.issue",
  slots: ["pdf", "email"]
})
export const identity = producer.identity({ operationId: appId, slot: "pdf" })
export const literals: {
  readonly operation: "billing.issue"
  readonly slot: "pdf"
  readonly operationId: string
} = identity
// @ts-expect-error Undeclared slots are rejected, not widened to string.
export const badSlot = producer.identity({ operationId: appId, slot: "sms" })
// @ts-expect-error Declarations and their copied slots are immutable.
producer.slots.push("sms")

export const job = Job.make({
  queue,
  kind: "invoice.generate",
  version: 1,
  payload: schema,
  encodePayload: encode
})
export const catalogLiteral: {
  readonly queue: "billing"
  readonly kind: "invoice.generate"
  readonly version: 1
} = job.catalog
export const input = {
  producer: identity,
  payload: { amount: 1.5 },
  policy: JobPolicy.make()
}
export const enqueue = job.enqueueInTransaction(tx, input)
export const explicitChannels: Effect.Effect<
  EnqueueResult,
  "backend-error" | JobEnqueueError,
  BackendService | EncodeService
> = enqueue
// @ts-expect-error Explicit tx is required.
export const standalone = job.enqueueInTransaction<never, never>(input)
export const arbitrary = job.enqueueInTransaction<never, never>(
  // @ts-expect-error A SQL-ish object is not a transaction capability.
  { query: () => {} },
  input
)
// @ts-expect-error Payload is decoded domain data, not its encoded representation.
export const encodedInput = job.enqueueInTransaction(tx, { ...input, payload: "encoded" })

export const handler = job.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      yield* HandlerService
      const amount: number = payload.amount
      const attempt: number = context.attemptNumber
      if (amount < attempt) {
        return yield* Effect.fail(
          JobFailures.Dead({ code: FailureCodes.define({ value: "rejected" }).value })
        )
      }
    }),
  decode
)
export const layerChannels: Layer.Layer<
  never,
  JobRegistry.DuplicateJobHandler,
  JobRegistry.JobRegistry | DecodeService | HandlerService
> = handler
export const finalizer = job.handlerLayer(
  (input) =>
    Effect.sync(() => {
      // @ts-expect-error Handler context has no finalization authority.
      input.context.complete()
    }),
  decode
)
// @ts-expect-error Decoder dependency is explicit.
export const missingDecoder = job.handlerLayer(() => Effect.void)
type ExpectFalse<T extends false> = T
export type MissingEncoder = ExpectFalse<
  typeof enqueue extends Effect.Effect<EnqueueResult, unknown, BackendService>
    ? true
    : false
>
export type DomainHandlerRejected = ExpectFalse<
  (() => Effect.Effect<void, "domain-error">) extends Parameters<
    typeof job.handlerLayer
  >[0]
    ? true
    : false
>
export type EnqueueNotClosed = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, unknown> ? true : false
>
export type ErrorNotErased = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, never, BackendService | EncodeService>
    ? true
    : false
>
export type HandlerNotClosed = ExpectFalse<
  typeof handler extends Layer.Layer<never, unknown, JobRegistry.JobRegistry>
    ? true
    : false
>
export type WrongErrors = ExpectFalse<
  Effect.Effect<void, "domain-error"> extends Effect.Effect<void, JobFailure>
    ? true
    : false
>

export const catalog = JobRegistry.catalog(job)
export const typedCatalog: Effect.Effect<
  readonly [typeof job],
  JobRegistry.DuplicateJobCatalogEntry
> = catalog
export const consumer = JobConsumer.make(queue, {
  localConcurrency: 1,
  claimLimitPerRun: 10,
  recoveryLimitPerRun: 10
})
declare const configured: JobConsumer.JobConsumer<typeof queue>
export const plan = JobConsumer.plan(configured)
export const typedPlan: Effect.Effect<
  JobConsumer.JobPlan<readonly [typeof configured]>,
  JobConsumer.DuplicateJobConsumer
> = plan
