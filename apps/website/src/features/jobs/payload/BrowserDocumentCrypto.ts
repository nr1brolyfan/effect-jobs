import { Effect, Schema } from "effect"
import {
  Envelope,
  PayloadUnlockError,
  importDocumentKeys,
  openDocument,
  openSyntheticDocument,
  syntheticDocumentCatalog
} from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"

export { PayloadUnlockError }

// The compatible document is the protected `document` field, never the whole payload.
export const documentEnvelope = (encoded: unknown) =>
  Schema.decodeUnknownEffect(Schema.Struct({ document: Envelope }))(encoded).pipe(
    Effect.map((value) => value.document),
    Effect.mapError(() => new PayloadUnlockError({ reason: "unsupported-envelope" }))
  )

export const isSyntheticCatalog = (catalog: {
  readonly queue: string
  readonly kind: string
  readonly version: number
}) =>
  catalog.queue === syntheticDocumentCatalog.queue &&
  catalog.kind === syntheticDocumentCatalog.kind &&
  catalog.version === syntheticDocumentCatalog.version

export const unlockSyntheticDocument = (encoded: unknown, code: string) =>
  code === "123"
    ? documentEnvelope(encoded).pipe(Effect.flatMap(openSyntheticDocument))
    : Effect.fail(new PayloadUnlockError({ reason: "authentication-failed" }))

const Key = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-fA-F]{64}$/)))
export const unlockPrivateDocument = (
  encoded: unknown,
  encryptionHex: string,
  fingerprintHex: string
) =>
  Effect.gen(function* () {
    const encryption = yield* Schema.decodeUnknownEffect(Key)(encryptionHex).pipe(
      Effect.mapError(() => new PayloadUnlockError({ reason: "invalid-key" }))
    )
    const fingerprint = yield* Schema.decodeUnknownEffect(Key)(fingerprintHex).pipe(
      Effect.mapError(() => new PayloadUnlockError({ reason: "invalid-key" }))
    )
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => ({
        encryption: Uint8Array.from({ length: 32 }, (_, index) =>
          Number.parseInt(encryption.slice(index * 2, index * 2 + 2), 16)
        ),
        fingerprint: Uint8Array.from({ length: 32 }, (_, index) =>
          Number.parseInt(fingerprint.slice(index * 2, index * 2 + 2), 16)
        )
      })),
      (raw) =>
        importDocumentKeys(raw.encryption, raw.fingerprint).pipe(
          Effect.flatMap((keys) =>
            documentEnvelope(encoded).pipe(
              Effect.flatMap((envelope) => openDocument(envelope, keys))
            )
          )
        ),
      (raw) =>
        Effect.sync(() => {
          raw.encryption.fill(0)
          raw.fingerprint.fill(0)
        })
    )
  })
