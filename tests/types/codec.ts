import { Context, Effect, Schema } from "effect"
import type { EncodedJobPayload, JobPayloadCodecError } from "../../src/JobContract.js"
import * as JobPayload from "../../src/JobPayload.js"
import { decodeJobPayload, encodeJobPayload } from "../../src/JobPayloadCodec.js"

class Encoding extends Context.Service<Encoding, {}>()("tests/codec/types/Encoding") {}
class Decoding extends Context.Service<Decoding, {}>()("tests/codec/types/Decoding") {}
declare const schema: Schema.Codec<
  { readonly amount: number },
  string,
  Decoding,
  Encoding
>
declare const artifact: EncodedJobPayload
export const encoding = encodeJobPayload(schema, { amount: 1.5 })
export const decoding = decodeJobPayload(schema, artifact)
export const encodeCheck: Effect.Effect<
  EncodedJobPayload,
  JobPayloadCodecError,
  Encoding
> = encoding
export const decodeCheck: Effect.Effect<
  { readonly amount: number },
  JobPayloadCodecError,
  Decoding
> = decoding
type True<A extends true> = A
type False<A extends false> = A
export type EncodeNotClosed = False<
  typeof encoding extends Effect.Effect<unknown, unknown> ? true : false
>
export type DecodeNotClosed = False<
  typeof decoding extends Effect.Effect<unknown, unknown> ? true : false
>
export type EncodeNotInfallible = False<
  typeof encoding extends Effect.Effect<unknown, never, Encoding> ? true : false
>
export type DecodeNotEncoded = False<
  typeof decoding extends Effect.Effect<string, unknown, Decoding> ? true : false
>
export type ExactEncodeServices = True<
  Effect.Services<typeof encoding> extends Encoding ? true : false
>
export type ExactDecodeServices = True<
  Effect.Services<typeof decoding> extends Decoding ? true : false
>
// @ts-expect-error Domain input is not the encoded representation.
export const wrongInput = encodeJobPayload(schema, "persisted")
const marked = JobPayload.protected(schema)
export const markedEncoding = encodeJobPayload(marked, { amount: 1.5 })
export type MarkerPreservesServices = False<
  typeof markedEncoding extends Effect.Effect<unknown, unknown> ? true : false
>
// @ts-expect-error Protection markers accept no projection callbacks.
export const callback = JobPayload.protected(Schema.Unknown, () => "fingerprint")
