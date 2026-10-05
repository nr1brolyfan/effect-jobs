import { Data } from "effect"
import type { Effect, Schema } from "effect"
import type { JobId } from "./JobId.js"
import type { CatalogIdentity, ProducerIdentity } from "./JobIdentity.js"
import type { JobPolicy } from "./JobPolicy.js"

export interface HandlerContext {
  readonly jobId: JobId
  readonly catalog: CatalogIdentity
  readonly producer: ProducerIdentity
  /** attemptsMade + 1; may repeat after unknown outcomes and stalled recovery. */
  readonly attemptNumber: number
}
export interface HandlerInput<Payload> {
  readonly payload: Payload
  readonly context: HandlerContext
}
export interface EnqueueInput<Payload> {
  readonly producer: ProducerIdentity
  readonly payload: Payload
  readonly policy: JobPolicy
  /** Omitted means database time on first insertion, never on matching duplicate. */
  readonly availableAt?: number
}
export type EnqueueResult = Data.TaggedEnum<{
  Inserted: { readonly jobId: JobId }
  AlreadyPresent: { readonly jobId: JobId }
}>
export const EnqueueResults = Data.taggedEnum<EnqueueResult>()

export const jobPayloadFormatVersion = 1
export const maximumJobPayloadBytes = 65_536
export const maximumJobSemanticProjectionBytes = 65_536
export const maximumProtectedJobPayloadSubtrees = 16
export const maximumJobPayloadSchemaPathBytes = 256
export const maximumJobPayloadDepth = 32

/** Codec owns validated canonical bytes; receivers copy bytes before retaining them. */
export interface EncodedJobPayload {
  readonly formatVersion: typeof jobPayloadFormatVersion
  readonly payloadBytes: Uint8Array
  readonly semanticProjectionBytes: Uint8Array
}
/** Signatures implemented by the codec unit; Schema services stay explicit. */
export type JobPayloadEncoder = <S extends Schema.Top>(
  schema: S,
  payload: S["Type"]
) => Effect.Effect<EncodedJobPayload, JobPayloadCodecError, S["EncodingServices"]>
export type JobPayloadDecoder = <S extends Schema.Top>(
  schema: S,
  encoded: EncodedJobPayload
) => Effect.Effect<S["Type"], JobPayloadCodecError, S["DecodingServices"]>
/** Producer-to-backend seam: no caller-supplied JobId. */
export interface PreparedJob {
  readonly catalog: CatalogIdentity
  readonly producer: ProducerIdentity
  readonly policy: JobPolicy
  readonly availableAt?: number
  readonly encoded: EncodedJobPayload
}
export class InvalidJobInput extends Data.TaggedError("InvalidJobInput")<{
  readonly field: "catalog" | "producer" | "policy" | "availableAt" | "payload"
}> {}
export class JobIntegrityConflict extends Data.TaggedError("JobIntegrityConflict")<{}> {}
export class JobPayloadCodecError extends Data.TaggedError("JobPayloadCodecError")<{
  readonly reason:
    | "invalid-json-value"
    | "invalid-encoding"
    | "invalid-schema"
    | "invalid-protected-value"
    | "payload-too-large"
    | "projection-too-large"
    | "too-many-protected-subtrees"
    | "schema-path-too-long"
    | "payload-too-deep"
    | "projection-mismatch"
}> {}
