import { Schema } from "effect"

// Explicitly public fixture material. Never use these keys for private documents.
export const syntheticDocumentCatalog = {
  queue: "playground-private",
  name: "playground.synthetic-document-export",
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
