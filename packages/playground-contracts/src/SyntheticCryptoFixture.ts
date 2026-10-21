import { Effect, Schema } from "effect"

// Explicitly public fixture material. Never use these keys for private documents.
export const syntheticDocumentCatalog = {
  queue: "playground-private",
  kind: "playground.synthetic-document-export",
  version: 1
} as const

export type Document = typeof Document.Type
export const Document = Schema.Struct({
  subject: Schema.Literal("demo-customer"),
  tenant: Schema.Literals(["demo-tenant-a", "demo-tenant-b"]),
  note: Schema.String.pipe(Schema.check(Schema.isMaxLength(256)))
})
const Byte = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 255 })))
export type Envelope = typeof Envelope.Type
export const Envelope = Schema.Struct({
  nonce: Schema.Array(Byte).pipe(
    Schema.check(Schema.isMinLength(12), Schema.isMaxLength(12))
  ),
  ciphertext: Schema.Array(Byte).pipe(
    Schema.check(Schema.isMinLength(16), Schema.isMaxLength(2048))
  ),
  fingerprint: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)))
})

export class PayloadUnlockError extends Schema.TaggedError<PayloadUnlockError>()(
  "PayloadUnlockError",
  {
    reason: Schema.Literals([
      "invalid-key",
      "authentication-failed",
      "unsupported-envelope",
      "unavailable"
    ])
  }
) {}
export interface DocumentKeys {
  readonly encryption: CryptoKey
  readonly fingerprint: CryptoKey
}
const aad = new TextEncoder().encode("playground-private-document-v1")
const canonical = (value: Document) =>
  new TextEncoder().encode(
    JSON.stringify({ subject: value.subject, tenant: value.tenant, note: value.note })
  )
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("")

// Web Crypto is the only async FFI; failures never retain provider diagnostics.
const operation = <A>(run: () => Promise<A>, reason: PayloadUnlockError["reason"]) =>
  Effect.tryPromise({ try: run, catch: () => new PayloadUnlockError({ reason }) })

export const importDocumentKeys = (encryption: Uint8Array, fingerprint: Uint8Array) =>
  Effect.suspend(() => {
    if (
      encryption.length !== 32 ||
      fingerprint.length !== 32 ||
      encryption.every((byte, index) => byte === fingerprint[index])
    ) {
      return Effect.fail(new PayloadUnlockError({ reason: "invalid-key" }))
    }
    // Snapshot caller-owned buffers before yielding; clear our copies on every exit.
    return Effect.acquireUseRelease(
      Effect.sync(() => ({
        encryption: new Uint8Array(encryption),
        fingerprint: new Uint8Array(fingerprint)
      })),
      (raw) =>
        operation(
          async (): Promise<DocumentKeys> => ({
            encryption: await crypto.subtle.importKey(
              "raw",
              raw.encryption,
              "AES-GCM",
              false,
              ["encrypt", "decrypt"]
            ),
            fingerprint: await crypto.subtle.importKey(
              "raw",
              raw.fingerprint,
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign", "verify"]
            )
          }),
          "invalid-key"
        ),
      (raw) =>
        Effect.sync(() => {
          raw.encryption.fill(0)
          raw.fingerprint.fill(0)
        })
    )
  })

export const syntheticDocumentKeys = () =>
  Effect.acquireUseRelease(
    Effect.sync(() => ({
      encryption: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      fingerprint: Uint8Array.from({ length: 32 }, (_, index) => index + 101)
    })),
    (raw) => importDocumentKeys(raw.encryption, raw.fingerprint),
    (raw) =>
      Effect.sync(() => {
        raw.encryption.fill(0)
        raw.fingerprint.fill(0)
      })
  )

export const openDocument = (input: unknown, keys: DocumentKeys) =>
  Effect.gen(function* () {
    const envelope = yield* Schema.decodeUnknownEffect(Envelope)(input, {
      onExcessProperty: "error"
    }).pipe(
      Effect.mapError(() => new PayloadUnlockError({ reason: "unsupported-envelope" }))
    )
    const nonce = new Uint8Array(envelope.nonce)
    const ciphertext = new Uint8Array(envelope.ciphertext)
    const signature = Uint8Array.from({ length: 32 }, (_, index) =>
      Number.parseInt(envelope.fingerprint.slice(index * 2, index * 2 + 2), 16)
    )
    return yield* Effect.acquireUseRelease(
      operation(
        async () =>
          new Uint8Array(
            await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
              keys.encryption,
              ciphertext
            )
          ),
        "authentication-failed"
      ),
      (bytes) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: (): unknown =>
              JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
            catch: () => new PayloadUnlockError({ reason: "authentication-failed" })
          })
          const document = yield* Schema.decodeUnknownEffect(Document)(parsed, {
            onExcessProperty: "error"
          }).pipe(
            Effect.mapError(
              () => new PayloadUnlockError({ reason: "authentication-failed" })
            )
          )
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => canonical(document)),
            (message) =>
              operation(
                () => crypto.subtle.verify("HMAC", keys.fingerprint, signature, message),
                "authentication-failed"
              ).pipe(
                Effect.flatMap((valid) =>
                  valid
                    ? Effect.succeed(document)
                    : Effect.fail(
                        new PayloadUnlockError({ reason: "authentication-failed" })
                      )
                )
              ),
            (message) => Effect.sync(() => message.fill(0))
          )
        }),
      (bytes) => Effect.sync(() => bytes.fill(0))
    )
  })

export const sealSyntheticDocument = (input: Document) =>
  Effect.gen(function* () {
    const document = yield* Schema.decodeUnknownEffect(Document)(input, {
      onExcessProperty: "error"
    }).pipe(
      Effect.mapError(() => new PayloadUnlockError({ reason: "authentication-failed" }))
    )
    const keys = yield* syntheticDocumentKeys()
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => canonical(document)),
      (bytes) =>
        operation(async (): Promise<Envelope> => {
          const nonce = crypto.getRandomValues(new Uint8Array(12))
          const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
            keys.encryption,
            bytes
          )
          const fingerprint = hex(
            await crypto.subtle.sign("HMAC", keys.fingerprint, bytes)
          )
          return {
            nonce: Array.from(nonce),
            ciphertext: Array.from(new Uint8Array(ciphertext)),
            fingerprint
          }
        }, "unavailable"),
      (bytes) => Effect.sync(() => bytes.fill(0))
    )
  })

export const openSyntheticDocument = (envelope: unknown) =>
  syntheticDocumentKeys().pipe(Effect.flatMap((keys) => openDocument(envelope, keys)))
