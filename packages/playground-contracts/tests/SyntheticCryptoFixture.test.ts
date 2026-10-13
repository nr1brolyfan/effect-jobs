import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import * as Fixture from "../src/SyntheticCryptoFixture.js"

const document: Fixture.Document = {
  subject: "demo-customer",
  tenant: "demo-tenant-a",
  note: "Synthetic fixture only"
}
const failure = <A>(work: Effect.Effect<A, Fixture.PayloadUnlockError>) =>
  Effect.runPromise(work.pipe(Effect.flip))

// Independent Web Crypto encoder checks compatibility rather than calling seal again.
const independentEnvelope = async (
  plaintext: string | Uint8Array,
  keys: Fixture.DocumentKeys,
  aad = "playground-private-document-v1"
) => {
  const bytes =
    typeof plaintext === "string"
      ? new TextEncoder().encode(plaintext)
      : new Uint8Array(plaintext)
  const nonce = new Uint8Array(12).fill(9)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode(aad),
      tagLength: 128
    },
    keys.encryption,
    bytes
  )
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", keys.fingerprint, bytes)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
  return {
    nonce: Array.from(nonce),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    fingerprint
  }
}

describe("explicit public synthetic document fixture", () => {
  it("uses nonextractable distinct AES/HMAC keys and randomized compatible envelopes", async () => {
    const keys = await Effect.runPromise(Fixture.syntheticDocumentKeys())
    expect(keys.encryption.extractable).toBe(false)
    expect(keys.fingerprint.extractable).toBe(false)
    expect(keys.encryption.algorithm.name).toBe("AES-GCM")
    expect(keys.fingerprint.algorithm.name).toBe("HMAC")
    const first = await Effect.runPromise(Fixture.sealSyntheticDocument(document))
    const second = await Effect.runPromise(Fixture.sealSyntheticDocument(document))
    expect(first.nonce).not.toEqual(second.nonce)
    expect(first.ciphertext).not.toEqual(second.ciphertext)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(await Effect.runPromise(Fixture.openSyntheticDocument(first))).toEqual(
      document
    )
    expect(
      await Effect.runPromise(
        Fixture.openSyntheticDocument(
          await independentEnvelope(JSON.stringify(document), keys)
        )
      )
    ).toEqual(document)
  })

  it("rejects nonce/ciphertext/fingerprint tampering, wrong AAD and either wrong key", async () => {
    const envelope = await Effect.runPromise(Fixture.sealSyntheticDocument(document))
    for (const altered of [
      {
        ...envelope,
        nonce: envelope.nonce.map((byte, index) => (index === 0 ? byte ^ 1 : byte))
      },
      {
        ...envelope,
        ciphertext: envelope.ciphertext.map((byte, index) =>
          index === 0 ? byte ^ 1 : byte
        )
      },
      {
        ...envelope,
        fingerprint: `${envelope.fingerprint[0] === "0" ? "1" : "0"}${envelope.fingerprint.slice(1)}`
      }
    ]) {
      expect((await failure(Fixture.openSyntheticDocument(altered))).reason).toBe(
        "authentication-failed"
      )
    }
    const good = await Effect.runPromise(Fixture.syntheticDocumentKeys())
    const wrong = await Effect.runPromise(
      Fixture.importDocumentKeys(
        new Uint8Array(32).fill(201),
        new Uint8Array(32).fill(202)
      )
    )
    for (const keys of [
      { encryption: wrong.encryption, fingerprint: good.fingerprint },
      { encryption: good.encryption, fingerprint: wrong.fingerprint }
    ]) {
      expect((await failure(Fixture.openDocument(envelope, keys))).reason).toBe(
        "authentication-failed"
      )
    }
    expect(
      (
        await failure(
          Fixture.openSyntheticDocument(
            await independentEnvelope(JSON.stringify(document), good, "wrong-aad")
          )
        )
      ).reason
    ).toBe("authentication-failed")
  })

  it("rejects authenticated but malformed JSON, UTF-8/domain/excess fields and Schema bounds", async () => {
    const keys = await Effect.runPromise(Fixture.syntheticDocumentKeys())
    for (const plaintext of [
      "{",
      new Uint8Array([0xc0, 0xaf]),
      JSON.stringify({ ...document, subject: "foreign" }),
      JSON.stringify({ ...document, tenant: "foreign" }),
      JSON.stringify({ ...document, extra: true }),
      JSON.stringify({ ...document, note: "x".repeat(257) })
    ]) {
      const error = await failure(
        Fixture.openSyntheticDocument(await independentEnvelope(plaintext, keys))
      )
      expect(error.reason).toBe("authentication-failed")
      expect(JSON.parse(JSON.stringify(error))).toEqual({
        _tag: "PayloadUnlockError",
        reason: "authentication-failed"
      })
    }
    expect(
      (
        await failure(
          Fixture.sealSyntheticDocument({ ...document, note: "x".repeat(257) })
        )
      ).reason
    ).toBe("authentication-failed")
  })

  it("clears owned decrypted byte buffers on success and document rejection", async () => {
    const keys = await Effect.runPromise(Fixture.syntheticDocumentKeys())
    const envelopes = [
      await independentEnvelope(JSON.stringify(document), keys),
      await independentEnvelope(JSON.stringify({ ...document, subject: "foreign" }), keys)
    ]
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle)
    const buffers: Uint8Array[] = []
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
      const result = await decrypt(...args)
      buffers.push(new Uint8Array(result))
      return result
    })
    try {
      await Effect.runPromise(Fixture.openSyntheticDocument(envelopes[0]))
      await failure(Fixture.openSyntheticDocument(envelopes[1]))
      expect(buffers).toHaveLength(2)
      expect(
        buffers.every((bytes) => bytes.length > 0 && bytes.every((byte) => byte === 0))
      ).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it("bounds envelopes and keys without mutating caller-owned buffers or artifacts", async () => {
    const envelope = await Effect.runPromise(Fixture.sealSyntheticDocument(document))
    const snapshot = JSON.stringify(envelope)
    for (const altered of [
      null,
      { ...envelope, extra: true },
      { ...envelope, nonce: [1] },
      { ...envelope, nonce: Array.from({ length: 12 }, () => 256) },
      { ...envelope, ciphertext: [] },
      { ...envelope, ciphertext: Array.from({ length: 2049 }, () => 0) },
      { ...envelope, fingerprint: "A".repeat(64) }
    ]) {
      expect((await failure(Fixture.openSyntheticDocument(altered))).reason).toBe(
        "unsupported-envelope"
      )
    }
    const encryption = new Uint8Array(32).fill(1)
    const fingerprint = new Uint8Array(32).fill(2)
    await Effect.runPromise(Fixture.importDocumentKeys(encryption, fingerprint))
    expect(encryption).toEqual(new Uint8Array(32).fill(1))
    expect(fingerprint).toEqual(new Uint8Array(32).fill(2))
    for (const pair of [
      [new Uint8Array(31), fingerprint],
      [encryption, new Uint8Array(33)],
      [encryption, encryption]
    ] as const) {
      expect((await failure(Fixture.importDocumentKeys(...pair))).reason).toBe(
        "invalid-key"
      )
    }
    expect(JSON.stringify(envelope)).toBe(snapshot)
  })
})
