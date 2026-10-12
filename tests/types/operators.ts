import { Context, Effect, Schema } from "effect"
import type { JobDefinition } from "../../src/Job.js"
import type { JobBackendError } from "../../src/JobEnqueue.js"
import type { JobIntegrityConflict, JobPayloadCodecError } from "../../src/JobContract.js"
import {
  JobOperators,
  type JobOperatorsService,
  type JobOperatorExpected,
  type JobOperatorRejected,
  type JobOperatorTransition,
  type JobRedriveRequest,
  type JobRedriveResult
} from "../../src/JobOperators.js"

class Connection extends Context.Service<Connection, {}>()(
  "tests/operators/Connection"
) {}
class Decoder extends Context.Service<Decoder, {}>()("tests/operators/Decoder") {}
class Encoder extends Context.Service<Encoder, {}>()("tests/operators/Encoder") {}
declare const definition: Pick<
  JobDefinition<Schema.Codec<{ readonly value: string }, string, Decoder, Encoder>>,
  "catalog" | "payload"
>
declare const service: JobOperatorsService<"storage-failure", Connection>
declare const expected: JobOperatorExpected
declare const request: JobRedriveRequest
export const retry: Effect.Effect<
  JobOperatorTransition,
  "storage-failure" | JobOperatorRejected,
  Connection
> = service.retryNow(expected)
export const cancelled: typeof retry = service.cancel(expected)
export const redriven = service.redrive(definition, request)
export const redriveCheck: Effect.Effect<
  JobRedriveResult,
  "storage-failure" | JobOperatorRejected | JobIntegrityConflict | JobPayloadCodecError,
  Connection | Decoder
> = redriven
export const generic = Effect.flatMap(JobOperators, (operators) =>
  operators.cancel(expected)
)
export const genericCheck: Effect.Effect<
  JobOperatorTransition,
  JobBackendError | JobOperatorRejected,
  JobOperators
> = generic
type False<T extends false> = T
type True<T extends true> = T
export type DecodeServicesRemain = False<
  typeof redriven extends Effect.Effect<unknown, unknown, Connection> ? true : false
>
export type EncodingNotRequired = True<
  Effect.Services<typeof redriven> extends Connection | Decoder ? true : false
>
// @ts-expect-error Operators require an exact expected lifecycle version.
export const incomplete = service.cancel({ jobId: expected.jobId, state: expected.state })
// @ts-expect-error Applications cannot choose a new job ID in a redrive request.
export const chosenId = service.redrive(definition, { ...request, jobId: expected.jobId })
