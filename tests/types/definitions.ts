import * as JobApi from "../../src/JobApi.js"
import * as JobApiBuilder from "../../src/JobApiBuilder.js"
import * as FailureCodes from "../../src/FailureCode.js"
import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as JobGroup from "../../src/JobGroup.js"
import * as JobProducer from "../../src/JobProducer.js"
import * as JobQueue from "../../src/JobQueue.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import { JobFailures } from "../../src/JobFailure.js"
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
export class TransactionContext extends Context.Service<TransactionContext, {}>()(
  "tests/definitions/TransactionContext"
) {}
declare const schema: Schema.Codec<
  { readonly amount: number },
  string,
  DecodeService,
  EncodeService
>
declare const tx: JobsTransaction<"jobs-error", TransactionContext>
declare const appId: string & { readonly AppId: unique symbol }

export const queue = JobQueue.make("billing")
export const job = Job.make({ kind: "invoice.generate", version: 1, payload: schema })
export const contractLiteral: { readonly kind: "invoice.generate"; readonly version: 1 } =
  job
export const producer = JobProducer.make("billing.issue").pipe(
  JobProducer.withSlot("pdf", job, { queue }),
  JobProducer.withSlot("email", Job.make({ kind: "invoice.email", payload: schema }), {
    queue
  })
)
export const input = {
  operationId: appId,
  slot: "pdf" as const,
  payload: { amount: 1.5 }
}
export const enqueue = producer.enqueueInTransaction(tx, input)
export const explicitChannels: Effect.Effect<
  EnqueueResult,
  "jobs-error" | JobEnqueueError,
  TransactionContext | EncodeService
> = enqueue
// @ts-expect-error Explicit tx is required.
export const missingTransaction = producer.enqueueInTransaction<never, never, "pdf">(
  input
)
export const arbitrary = producer.enqueueInTransaction<never, never, "pdf">(
  // @ts-expect-error A SQL-ish object is not a transaction capability.
  { query: () => {} },
  input
)
export const encodedInput = producer.enqueueInTransaction(tx, {
  ...input,
  // @ts-expect-error Payload is decoded domain data, not its encoded representation.
  payload: "encoded"
})
export const badSlot = producer.enqueue({
  ...input,
  // @ts-expect-error Slots are closed declarations.
  slot: "sms"
})
// @ts-expect-error Slot bindings are immutable.
producer.slots.pdf = producer.slots.email
// @ts-expect-error A contract does not include routing.
export const missingQueue = job.queue
// @ts-expect-error Production belongs to the producer.
job.enqueue(input)
// @ts-expect-error Handler installation belongs to a complete group.
job.handlerLayer(() => Effect.void)
// @ts-expect-error The artifact codec is not a per-definition override.
Job.make({ kind: "invoice.generate", payload: schema, encodePayload: () => Effect.void })
// @ts-expect-error Queue is not contract identity.
Job.make({ kind: "invoice.generate", payload: schema, queue })

export const group = JobGroup.make("typed-invoices", { pdf: job })
export const handler = JobApiBuilder.group(
  JobApi.make(group.name).pipe(JobApi.addGroup(group)),
  group.name,
  (_handlers) =>
    _handlers.handle("pdf", (input) =>
      Effect.gen(function* () {
        yield* HandlerService
        const amount: number = input.payload.amount
        const attempt: number = input.context.nextFinalizationNumber
        // @ts-expect-error Handler context has no finalization authority.
        input.context.complete()
        if (amount < attempt) {
          return yield* Effect.fail(
            JobFailures.Dead({ code: FailureCodes.define({ value: "rejected" }).value })
          )
        }
      })
    )
)
export const layerChannels: Layer.Layer<
  JobGroup.Handlers<"typed-invoices", typeof group.definitions>,
  JobGroup.JobGroupConfigurationError,
  DecodeService | HandlerService
> = handler
type ExpectFalse<T extends false> = T
export type DomainErrorsRejected = ExpectFalse<
  (() => Effect.Effect<void, "domain-error">) extends JobGroup.HandlersFrom<
    typeof group.definitions
  >["pdf"]
    ? true
    : false
>
export type MissingEncoder = ExpectFalse<
  typeof enqueue extends Effect.Effect<EnqueueResult, unknown, TransactionContext>
    ? true
    : false
>
export type EnqueueNotClosed = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, unknown> ? true : false
>
export type ErrorNotErased = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, never, TransactionContext | EncodeService>
    ? true
    : false
>
export type HandlerNotClosed = ExpectFalse<
  typeof handler extends Layer.Layer<unknown, unknown, DecodeService> ? true : false
>
