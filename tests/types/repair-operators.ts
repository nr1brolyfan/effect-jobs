import { Context, Schema } from "effect"
import type { Effect } from "effect"
import type { JobDefinition } from "../../src/Job.js"
import type { JobIntegrityConflict, JobPayloadCodecError } from "../../src/JobContract.js"
import type {
  JobCorrectedRedriveRequest,
  JobOperatorsService,
  JobOperatorRejected,
  JobRedriveResult
} from "../../src/JobOperators.js"
class Connection extends Context.Service<Connection, {}>()("tests/repair/Connection") {}
class Encoder extends Context.Service<Encoder, {}>()("tests/repair/Encoder") {}
class Decoder extends Context.Service<Decoder, {}>()("tests/repair/Decoder") {}
declare const definition: Pick<
  JobDefinition<Schema.Codec<{ readonly value: string }, string, Decoder, Encoder>>,
  "catalog" | "payload"
>
declare const service: JobOperatorsService<"storage", Connection>
declare const request: JobCorrectedRedriveRequest<{ readonly value: string }>
export const corrected = service.correctedRedrive(definition, request)
export const check: Effect.Effect<
  JobRedriveResult,
  "storage" | JobOperatorRejected | JobIntegrityConflict | JobPayloadCodecError,
  Connection | Encoder | Decoder
> = corrected
type False<T extends false> = T
export type EncodingRemains = False<
  typeof corrected extends Effect.Effect<unknown, unknown, Connection | Decoder>
    ? true
    : false
>
export type DecodingRemains = False<
  typeof corrected extends Effect.Effect<unknown, unknown, Connection | Encoder>
    ? true
    : false
>
export const wrongPayload = service.correctedRedrive(definition, {
  ...request,
  // @ts-expect-error Replacement is decoded domain data, not the encoded string.
  payload: "encoded"
})
// @ts-expect-error A corrected request requires full replacement data.
export const missingPayload = service.correctedRedrive(definition, {
  expected: request.expected,
  producer: request.producer
})
