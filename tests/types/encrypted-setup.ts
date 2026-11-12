import { Context, Effect, Schema } from "effect"
import * as Payload from "../../src/JobPayload.js"

class DomainEncoding extends Context.Service<DomainEncoding, {}>()(
  "setup/types/DomainEncoding"
) {}
class DomainDecoding extends Context.Service<DomainDecoding, {}>()(
  "setup/types/DomainDecoding"
) {}
class SealKeys extends Context.Service<SealKeys, {}>()("setup/types/SealKeys") {}
class OpenKeys extends Context.Service<OpenKeys, {}>()("setup/types/OpenKeys") {}

declare const domain: Schema.Codec<
  { readonly amount: bigint },
  string,
  DomainDecoding,
  DomainEncoding
>
const Envelope = Schema.Struct({ ciphertext: Schema.String, fingerprint: Schema.String })
declare const codec: Payload.EncryptionCodec<string, typeof Envelope, SealKeys, OpenKeys>
export const setup = Payload.encrypted({ schema: domain, codec })
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type True<A extends true> = A
export type SetupError = True<
  Exact<Effect.Error<typeof setup>, Payload.InvalidEncryptedSchema>
>
export type SetupServices = True<Exact<Effect.Services<typeof setup>, never>>
export type CodecType = True<
  Exact<Effect.Success<typeof setup>["Type"], { readonly amount: bigint }>
>
export type CodecEncoded = True<
  Exact<Effect.Success<typeof setup>["Encoded"], typeof Envelope.Encoded>
>
export type CodecEncoding = True<
  Exact<Effect.Success<typeof setup>["EncodingServices"], DomainEncoding | SealKeys>
>
export type CodecDecoding = True<
  Exact<Effect.Success<typeof setup>["DecodingServices"], DomainDecoding | OpenKeys>
>
// @ts-expect-error Setup can fail with InvalidEncryptedSchema.
export type NotInfallible = True<Exact<Effect.Error<typeof setup>, never>>
// @ts-expect-error Construction must be executed before Schema composition.
export const eager = Schema.Struct({ protected: setup })
type EncodingServices = Effect.Success<typeof setup>["EncodingServices"]
type DecodingServices = Effect.Success<typeof setup>["DecodingServices"]
// @ts-expect-error Encoding still requires domain and seal services.
export type EncodingNotClosed = True<Exact<EncodingServices, never>>
// @ts-expect-error Decoding still requires domain and open services.
export type DecodingNotClosed = True<Exact<DecodingServices, never>>
export const checks = setup.pipe(
  Effect.map((schema) => {
    // @ts-expect-error Decoded domain input differs from the persisted envelope.
    return Schema.encodeEffect(schema)({ ciphertext: "opaque", fingerprint: "stable" })
  })
)
