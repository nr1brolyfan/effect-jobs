/** Real local AES-GCM/HMAC fixture. Application-owned, never a library default. */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import { Context, Data, Effect, Layer, Schema } from "effect"
import * as Payload from "../../../src/JobPayload.js"

export const Document = Schema.Struct({
  recipient: Schema.String,
  total: Schema.BigIntFromString
})
export const Envelope = Schema.Struct({
  keyId: Schema.String,
  nonce: Schema.String,
  ciphertext: Schema.String,
  tag: Schema.String,
  fingerprint: Schema.String
})
export interface Keyring {
  readonly active: string
  readonly encryption: Readonly<Record<string, Uint8Array>>
  readonly fingerprint: Uint8Array
}
export class DocumentKeys extends Context.Service<DocumentKeys, Keyring>()(
  "fixture/DocumentKeys"
) {}
export class PersonalKeys extends Context.Service<PersonalKeys, Keyring>()(
  "fixture/PersonalKeys"
) {}
export class InvalidKeys extends Data.TaggedError("InvalidKeys")<{}> {}

export const keys = (active = "one", namespace = 1): Keyring => ({
  active,
  encryption: {
    one: new Uint8Array(32).fill(namespace),
    two: new Uint8Array(32).fill(namespace + 1)
  },
  fingerprint: new Uint8Array(32).fill(namespace + 2)
})
export const keysLayer = (config: Keyring) =>
  Layer.effect(
    DocumentKeys,
    Effect.gen(function* () {
      if (
        config.encryption[config.active]?.byteLength !== 32 ||
        config.fingerprint.byteLength !== 32
      ) {
        return yield* new InvalidKeys()
      }
      return config
    })
  )

const canonical = (value: typeof Document.Encoded) =>
  JSON.stringify({ recipient: value.recipient, total: value.total })
const seal = (ring: Keyring, value: typeof Document.Encoded) =>
  Effect.try({
    try: () => {
      const plaintext = canonical(value)
      const nonce = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", ring.encryption[ring.active]!, nonce)
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      return {
        keyId: ring.active,
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        fingerprint: createHmac("sha256", ring.fingerprint)
          .update(plaintext)
          .digest("hex")
      }
    },
    catch: () => new Payload.JobEncryptionError()
  })
const open = (ring: Keyring, envelope: typeof Envelope.Type) =>
  Effect.try({
    try: () => {
      const key = ring.encryption[envelope.keyId]
      if (!key) {
        throw new Error("invalid fixture key")
      }
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.nonce, "base64")
      )
      cipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
      const plaintext = Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, "base64")),
        cipher.final()
      ]).toString("utf8")
      const expected = createHmac("sha256", ring.fingerprint)
        .update(plaintext)
        .digest("hex")
      if (expected !== envelope.fingerprint) {
        throw new Error("invalid fixture fingerprint")
      }
      // Schema owns validation after this untrusted decoded JSON boundary.
      return JSON.parse(plaintext) as typeof Document.Encoded
    },
    catch: () => new Payload.JobEncryptionError()
  })
export const DocumentEncryption: Payload.EncryptionCodec<
  typeof Document.Encoded,
  typeof Envelope,
  DocumentKeys,
  DocumentKeys
> = {
  envelope: Envelope,
  seal: (value) => Effect.flatMap(DocumentKeys, (ring) => seal(ring, value)),
  open: (value) => Effect.flatMap(DocumentKeys, (ring) => open(ring, value))
}
export const PersonalEncryption: Payload.EncryptionCodec<
  typeof Document.Encoded,
  typeof Envelope,
  PersonalKeys,
  PersonalKeys
> = {
  envelope: Envelope,
  seal: (value) => Effect.flatMap(PersonalKeys, (ring) => seal(ring, value)),
  open: (value) => Effect.flatMap(PersonalKeys, (ring) => open(ring, value))
}
export const EncryptedDocument = Payload.encrypted({
  schema: Document,
  codec: DocumentEncryption
})
