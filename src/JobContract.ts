/**
 * Shared handler, enqueue and bounded encoded-artifact contracts.
 */
import { Data } from "effect"
import type { Effect, Schema } from "effect"
import type { JobId } from "./JobId.js"
import type { CatalogIdentity, ProducerIdentity } from "./JobIdentity.js"
import type { JobPolicy } from "./JobPolicy.js"

/**
 * Handler metadata without SQL, lease tokens or finalization authority.
 * attemptNumber is one-based and may repeat after unknown outcomes and recovery.
 *
 * @category models
 */
export interface HandlerContext {
  readonly jobId: JobId
  readonly catalog: CatalogIdentity
  readonly producer: ProducerIdentity
  /** attemptsMade + 1; may repeat after unknown outcomes and stalled recovery. */
  readonly attemptNumber: number
}
/**
 * Decoded Schema payload plus library metadata; handler dependencies use Effect services.
 *
 * @category models
 */
export interface HandlerInput<Payload> {
  readonly payload: Payload
  readonly context: HandlerContext
}
/**
 * Decoded payload, stable producer identity and resolved policy. No caller job ID.
 * Matching duplicates retain the original policy and availability.
 *
 * @category models
 */
export interface EnqueueInput<Payload> {
  readonly producer: ProducerIdentity
  readonly payload: Payload
  readonly policy: JobPolicy
  /** Omitted means database time on first insertion, never on matching duplicate. */
  readonly availableAt?: number
}
/**
 * Inserted or AlreadyPresent with the durable job ID. Success inside a joined
 * transaction is provisional until the application owner commits.
 *
 * @category models
 */
export type EnqueueResult = Data.TaggedEnum<{
  Inserted: { readonly jobId: JobId }
  AlreadyPresent: { readonly jobId: JobId }
}>
/**
 * Tagged constructors and matchers for enqueue results.
 *
 * @category constructors
 */
export const EnqueueResults = Data.taggedEnum<EnqueueResult>()

/**
 * Current canonical encoded payload/projection format discriminator.
 *
 * @category constants
 */
export const jobPayloadFormatVersion = 1
/**
 * Maximum canonical payload size in bytes (64 KiB).
 *
 * @category constants
 */
export const maximumJobPayloadBytes = 65_536
/**
 * Maximum canonical semantic-projection size in bytes (64 KiB).
 *
 * @category constants
 */
export const maximumJobSemanticProjectionBytes = 65_536
/**
 * Maximum marked protected subtrees per payload (16).
 *
 * @category constants
 */
export const maximumProtectedJobPayloadSubtrees = 16
/**
 * Maximum protected Schema path size in UTF-8 bytes (256).
 *
 * @category constants
 */
export const maximumJobPayloadSchemaPathBytes = 256
/**
 * Maximum payload nesting depth (32).
 *
 * @category constants
 */
export const maximumJobPayloadDepth = 32

/**
 * Validated canonical payload and semantic bytes. Codec executions own their buffers;
 * receivers copy before retention because readonly does not freeze Uint8Array contents.
 *
 * @category models
 */
export interface EncodedJobPayload {
  readonly formatVersion: typeof jobPayloadFormatVersion
  readonly payloadBytes: Uint8Array
  readonly semanticProjectionBytes: Uint8Array
}
/**
 * Codec signature preserving Schema encoding services in the Effect environment.
 *
 * @category models
 */
export type JobPayloadEncoder = <S extends Schema.Top>(
  schema: S,
  payload: S["Type"]
) => Effect.Effect<EncodedJobPayload, JobPayloadCodecError, S["EncodingServices"]>
/**
 * Codec signature preserving Schema decoding services in the Effect environment.
 *
 * @category models
 */
export type JobPayloadDecoder = <S extends Schema.Top>(
  schema: S,
  encoded: EncodedJobPayload
) => Effect.Effect<S["Type"], JobPayloadCodecError, S["DecodingServices"]>
/**
 * Producer-to-backend artifact and first configuration; the backend assigns the ID.
 *
 * @category models
 */
export interface PreparedJob {
  readonly catalog: CatalogIdentity
  readonly producer: ProducerIdentity
  readonly policy: JobPolicy
  readonly availableAt?: number
  readonly encoded: EncodedJobPayload
}
/**
 * Typed enqueue validation failure exposing only the invalid field.
 *
 * @category errors
 */
export class InvalidJobInput extends Data.TaggedError("InvalidJobInput")<{
  readonly field: "catalog" | "producer" | "policy" | "availableAt" | "payload"
}> {}
/**
 * Same producer tuple with different catalog or semantic payload. Propagate the
 * failure to the transaction owner; do not commit partial domain writes.
 *
 * @category errors
 */
export class JobIntegrityConflict extends Data.TaggedError("JobIntegrityConflict")<{}> {}
/**
 * Bounded codec failure reason without raw payload or Schema diagnostic inputs.
 *
 * @category errors
 */
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
