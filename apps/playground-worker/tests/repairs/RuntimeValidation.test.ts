import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Cursor from "../../src/server/read/CursorCodec.js"
import * as Documents from "../../src/scenarios/PrivateDocument.js"

const cursorFixture = async () => {
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  )
  const position: Cursor.Position = {
    version: 2,
    view: "jobs",
    sandbox: Fixtures.sandbox.ref,
    filters: {},
    after: "example-job"
  }
  return { codec: Cursor.make(key), key, position }
}

describe("owned cursor validation uses the bounded typed channel", () => {
  it("roundtrips a signed cursor and supports independent concurrent decodes", async () => {
    const { codec, position } = await cursorFixture()
    const cursor = await Effect.runPromise(codec.encode(position))
    const values = await Effect.runPromise(
      Effect.all([codec.decode(cursor), codec.decode(cursor)], { concurrency: 2 })
    )
    expect(values).toEqual([position, position])
  })

  it.each([
    "missing-separator",
    "a.b.c",
    "=.AAAA",
    "A.AAAA",
    "AB.AAAA",
    "e30.AA",
    `e30.${"A".repeat(43)}`
  ])("rejects malformed, noncanonical or invalid signature input %s", async (cursor) => {
    const { codec } = await cursorFixture()
    const exit = await Effect.runPromiseExit(codec.decode(cursor))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
      const reason = exit.cause.reasons[0]!
      if (Cause.isFailReason(reason)) {
        expect(reason.error).toEqual(new PlaygroundError({ code: "invalid-request" }))
      }
    }
  })

  it("keeps invalid-key construction as a synchronous configuration failure", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt"
    ])
    expect(() => Cursor.make(key)).toThrow("Cursor key requires HMAC SHA-256")
  })
})

describe("private document validation composes outside the crypto adapter", () => {
  it("roundtrips and rejects a mismatched fingerprint without defects", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const document = {
          subject: "demo-customer" as const,
          tenant: "demo-tenant-a" as const,
          note: "Synthetic example"
        }
        const sealed = yield* Schema.encodeEffect(Documents.EncryptedDocument)(document)
        expect(yield* Schema.decodeEffect(Documents.EncryptedDocument)(sealed)).toEqual(
          document
        )
        const mismatch = {
          ...sealed,
          fingerprint:
            sealed.fingerprint === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64)
        }
        for (const input of [mismatch, { ...sealed, ciphertext: [0] }]) {
          const exit = yield* Effect.exit(
            Schema.decodeEffect(Documents.EncryptedDocument)(input)
          )
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
            expect(JSON.stringify(exit.cause)).not.toContain(document.note)
          }
        }
      }).pipe(Effect.provide(Documents.keysLayer))
    )
  })

  it.each(["invalid-json", "invalid-document"])(
    "rejects authentic ciphertext containing %s through Schema failure",
    async (kind) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const keys = yield* Documents.DocumentKeys
          const bytes = new TextEncoder().encode(
            kind === "invalid-json" ? "{" : JSON.stringify({ subject: "wrong" })
          )
          const nonce = crypto.getRandomValues(new Uint8Array(12))
          const ciphertext = yield* Effect.promise(() =>
            crypto.subtle.encrypt(
              {
                name: "AES-GCM",
                iv: nonce,
                additionalData: new TextEncoder().encode("playground-private-document-v1")
              },
              keys.encryption,
              bytes
            )
          )
          const exit = yield* Effect.exit(
            Schema.decodeEffect(Documents.EncryptedDocument)({
              nonce: Array.from(nonce),
              ciphertext: Array.from(new Uint8Array(ciphertext)),
              fingerprint: "0".repeat(64)
            })
          )
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
          }
        }).pipe(Effect.provide(Documents.keysLayer))
      )
    }
  )
})
