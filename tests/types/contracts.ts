import * as FailureCodes from "../../src/FailureCode.js"
import { Context, Duration, Effect, Schema } from "effect"
import type {
  HandlerInput,
  EnqueueInput,
  EncodedJobPayload,
  PreparedJob,
  JobPayloadEncoder,
  JobPayloadDecoder
} from "../../src/JobContract.js"
import { JobFailures, type JobFailure } from "../../src/JobFailure.js"
import { JobId } from "../../src/JobId.js"
import type { CatalogIdentity, ProducerIdentity } from "../../src/JobIdentity.js"
import * as JobPolicy from "../../src/JobPolicy.js"
import type { JobsTransaction, JobTransactionsService } from "../../src/JobTransaction.js"
import {
  insertPrepared,
  withJoinedTransaction
} from "../../src/internal/JobTransaction.js"

// Included in the normal strict compiler gate; unused @ts-expect-error is an error.
const id: JobId = Schema.decodeSync(JobId)("opaque")
// @ts-expect-error Applications cannot fabricate library JobId from plain strings.
const rawId: JobId = "opaque"
export const ids = [id, rawId]
type AppOperationId = string & { readonly AppOperationId: unique symbol }
declare const operationId: AppOperationId
export const producer: ProducerIdentity<"billing.issue", "email"> = {
  operation: "billing.issue",
  slot: "email",
  operationId
}
export const catalog: CatalogIdentity<"billing", "email", 1> = {
  queue: "billing",
  kind: "email",
  version: 1
}
export const wrongCatalog: CatalogIdentity<"billing", "email", 1> = {
  queue: "billing",
  kind: "email",
  // @ts-expect-error Wrong catalog version literal.
  version: 2
}
export const policy = JobPolicy.make({ retryDelay: Duration.seconds(5) })
// @ts-expect-error Public duration inputs are not raw milliseconds.
export const rawDuration = JobPolicy.make({ retryDelay: 5000 })
// @ts-expect-error Resolved durable policy cannot omit retention.
export const incompletePolicy: JobPolicy.JobPolicy = {
  leaseDurationMillis: 90000,
  attemptTimeoutMillis: 30000,
  maxAttempts: 3,
  maxStalledCount: 1,
  retrySchedule: { _tag: "FixedDelayV1", delayMillis: 5000 }
}
export const input: EnqueueInput<{ readonly invoiceId: string }> = {
  producer,
  policy,
  payload: { invoiceId: "invoice" }
}
export const wrongPayload: EnqueueInput<{ readonly invoiceId: string }> = {
  producer,
  policy,
  // @ts-expect-error Decoded domain input remains typed.
  payload: { invoiceId: 1 }
}
export const overrideId: EnqueueInput<string> = {
  producer,
  policy,
  payload: "x",
  // @ts-expect-error No caller JobId override.
  jobId: id
}
export const outcome: JobFailure = JobFailures.OutcomeUnknown({
  code: FailureCodes.define({ value: "lost_response" }).value
})
// @ts-expect-error Arbitrary domain errors are not library handler failures.
export const domainFailure: JobFailure = { _tag: "DomainError", code: "x" }
declare const handlerInput: HandlerInput<string>
// @ts-expect-error Handler context has no transaction or finalization authority.
export const noTransaction = handlerInput.context.transaction
// @ts-expect-error Callback capability cannot be fabricated structurally.
export const fabricated: JobsTransaction = {}
export class Backend extends Context.Service<Backend, {}>()("tests/contracts/Backend") {}
declare const tx: JobsTransaction<"backend-error", Backend>
declare const prepared: PreparedJob
export const enqueue: Effect.Effect<
  unknown,
  "backend-error" | import("../../src/JobTransaction.js").JobEnqueueError,
  Backend
> = insertPrepared(tx, prepared)
type ExpectFalse<A extends false> = A
// Type-level negative assertions avoid intentionally emitting Effect diagnostics.
export type MissingRequirement = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, unknown> ? true : false
>
export type MissingError = ExpectFalse<
  typeof enqueue extends Effect.Effect<unknown, never, Backend> ? true : false
>
declare const manager: JobTransactionsService<"manager-error", Backend>
export const managed: Effect.Effect<string, "manager-error", Backend> =
  manager.withTransaction(() => Effect.succeed("ok"))
export type Unmanaged = ExpectFalse<
  typeof managed extends Effect.Effect<string, "manager-error"> ? true : false
>
declare const encoded: EncodedJobPayload
// @ts-expect-error Only durable format version 1 is supported.
export const wrongFormat: EncodedJobPayload = { ...encoded, formatVersion: 2 }
// @ts-expect-error Prepared artifacts have no generated candidate ID.
export const candidateId: PreparedJob = { ...prepared, jobId: id }
export const joined = withJoinedTransaction(
  () => Effect.fail("backend-error" as const),
  (joinedTx) => insertPrepared(joinedTx, prepared)
)
export class EncodeService extends Context.Service<EncodeService, {}>()(
  "tests/contracts/Encode"
) {}
export class DecodeService extends Context.Service<DecodeService, {}>()(
  "tests/contracts/Decode"
) {}
declare const servicedSchema: Schema.Codec<
  { readonly amount: number },
  string,
  DecodeService,
  EncodeService
>
declare const encode: JobPayloadEncoder
declare const decode: JobPayloadDecoder
export const encoding = encode(servicedSchema, { amount: 1.5 })
export const decoding = decode(servicedSchema, encoded)
type ExpectTrue<A extends true> = A
export type EncodingServicesPreserved = ExpectTrue<
  typeof encoding extends Effect.Effect<EncodedJobPayload, unknown, EncodeService>
    ? true
    : false
>
export type DecodingServicesPreserved = ExpectTrue<
  typeof decoding extends Effect.Effect<
    { readonly amount: number },
    unknown,
    DecodeService
  >
    ? true
    : false
>
export type EncodingNotClosed = ExpectFalse<
  typeof encoding extends Effect.Effect<unknown, unknown> ? true : false
>
export type DecodingNotClosed = ExpectFalse<
  typeof decoding extends Effect.Effect<unknown, unknown> ? true : false
>
// @ts-expect-error Codec accepts decoded domain values, not the persisted representation.
export const encodedAsInput = encode(servicedSchema, "persisted")
