import { Context, Effect, Layer, Schema } from "effect"
import * as JobPayload from "effect-jobs/JobPayload"

// Web Crypto is the application FFI. Keys are ephemeral and synthetic; no env access.
export class DocumentKeys extends Context.Service<
  DocumentKeys,
  { readonly encryption: CryptoKey; readonly fingerprint: CryptoKey }
>()("playground/DocumentKeys") {}

export const Document = Schema.Struct({
  subject: Schema.Literal("demo-customer"),
  tenant: Schema.Literals(["demo-tenant-a", "demo-tenant-b"]),
  note: Schema.String.pipe(Schema.check(Schema.isMaxLength(256)))
})
const Envelope = Schema.Struct({
  nonce: Schema.Array(
    Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 255 })))
  ).pipe(Schema.check(Schema.isMinLength(12), Schema.isMaxLength(12))),
  ciphertext: Schema.Array(
    Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 255 })))
  ).pipe(Schema.check(Schema.isMaxLength(2048))),
  fingerprint: Schema.String.pipe(
    Schema.check(Schema.isMinLength(64), Schema.isMaxLength(64))
  )
})
const aad = new TextEncoder().encode("playground-private-document-v1")
const canonical = (value: typeof Document.Encoded) =>
  new TextEncoder().encode(
    JSON.stringify({ subject: value.subject, tenant: value.tenant, note: value.note })
  )
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("")
const cryptoOperation = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new JobPayload.JobEncryptionError() })

export const keysLayer = Layer.effect(
  DocumentKeys,
  cryptoOperation(async () => ({
    encryption: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt"
    ]),
    fingerprint: await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"]
    )
  }))
)

const codec: JobPayload.EncryptionCodec<
  typeof Document.Encoded,
  typeof Envelope,
  DocumentKeys,
  DocumentKeys
> = {
  envelope: Envelope,
  seal: (value) =>
    Effect.gen(function* () {
      const keys = yield* DocumentKeys
      return yield* cryptoOperation(async () => {
        const bytes = canonical(value)
        const nonce = crypto.getRandomValues(new Uint8Array(12))
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad },
          keys.encryption,
          bytes
        )
        const fingerprint = hex(await crypto.subtle.sign("HMAC", keys.fingerprint, bytes))
        return {
          nonce: Array.from(nonce),
          ciphertext: Array.from(new Uint8Array(ciphertext)),
          fingerprint
        }
      })
    }),
  open: (envelope) =>
    Effect.gen(function* () {
      const keys = yield* DocumentKeys
      return yield* cryptoOperation(async () => {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(envelope.nonce), additionalData: aad },
          keys.encryption,
          new Uint8Array(envelope.ciphertext)
        )
        const value = Schema.decodeUnknownSync(Document)(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
          { onExcessProperty: "error" }
        )
        const expected = hex(
          await crypto.subtle.sign("HMAC", keys.fingerprint, canonical(value))
        )
        if (expected !== envelope.fingerprint) {
          throw new JobPayload.JobEncryptionError()
        }
        return value
      })
    })
}

export const EncryptedDocument = JobPayload.encrypted({ schema: Document, codec })
