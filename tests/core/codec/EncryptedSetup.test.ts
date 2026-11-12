import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Payload from "../../../src/JobPayload.js"
import { decodeJobPayload, encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { hasEncryption } from "../../../src/internal/codec/EncryptedBoundary.js"

const Envelope = Schema.Struct({ ciphertext: Schema.String, fingerprint: Schema.String })
const codec: Payload.EncryptionCodec<string, typeof Envelope> = {
  envelope: Envelope,
  seal: (value) => Effect.succeed({ ciphertext: value, fingerprint: "stable" }),
  open: (value) => Effect.succeed(value.ciphertext)
}

const failedSetup = (schema: Schema.Top, envelope: Schema.Codec<unknown> = Envelope) =>
  Effect.runSyncExit(
    Payload.encrypted({
      schema,
      codec: {
        envelope,
        seal: () => Effect.die("unused"),
        open: () => Effect.die("unused")
      }
    })
  )

const expectSetupFailure = (
  exit: Exit.Exit<unknown, Payload.InvalidEncryptedSchema>,
  reason: Payload.InvalidEncryptedSchema["reason"]
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toHaveLength(1)
    expect(exit.cause.reasons[0]).toMatchObject({
      _tag: "Fail",
      error: { _tag: "InvalidEncryptedSchema", reason }
    })
    expect(Cause.hasDies(exit.cause)).toBe(false)
  }
}

describe("lazy encrypted schema setup", () => {
  it("reads options only on execution and reports invalid envelopes as typed failures", () => {
    let reads = 0
    const options = {
      get schema() {
        reads++
        return Schema.String
      },
      codec: {
        envelope: Schema.Struct({ ciphertext: Schema.String }),
        seal: () => Effect.die("unused"),
        open: () => Effect.die("unused")
      }
    }
    const setup = Payload.encrypted(options)
    expect(reads).toBe(0)
    expectSetupFailure(Effect.runSyncExit(setup), "invalid-envelope")
    expect(reads).toBe(1)
    expectSetupFailure(Effect.runSyncExit(setup), "invalid-envelope")
    expect(reads).toBe(2)
  })

  it("takes fresh execution snapshots while preserving captured methods and their receiver", async () => {
    const mutable = {
      ...codec,
      label: "receiver",
      seal(this: { label: string }, value: string) {
        return Effect.succeed({
          ciphertext: `${this.label}:${value}`,
          fingerprint: "first"
        })
      }
    }
    const options = { schema: Schema.String, codec: mutable }
    const setup = Payload.encrypted(options)
    const first = Effect.runSync(setup)
    mutable.seal = function (value: string) {
      return Effect.succeed({ ciphertext: `changed:${value}`, fingerprint: "second" })
    }
    const second = Effect.runSync(setup)
    expect(first).not.toBe(second)
    expect(first.ast).not.toBe(second.ast)
    expect(await Effect.runPromise(Schema.encodeEffect(first)("x"))).toEqual({
      ciphertext: "receiver:x",
      fingerprint: "first"
    })
    expect(await Effect.runPromise(Schema.encodeEffect(second)("x"))).toEqual({
      ciphertext: "changed:x",
      fingerprint: "second"
    })
    mutable.envelope = Payload.protected(Envelope)
    expectSetupFailure(Effect.runSyncExit(setup), "nested-encryption")
    expect(await Effect.runPromise(Schema.encodeEffect(first)("x"))).toEqual({
      ciphertext: "receiver:x",
      fingerprint: "first"
    })
    mutable.envelope = Envelope
    expect(Exit.isSuccess(Effect.runSyncExit(setup))).toBe(true)
  })

  it("finishes link registration before success and preserves it through annotations and fields", () => {
    const encrypted = Effect.runSync(Payload.encrypted({ schema: Schema.String, codec }))
    expect(hasEncryption(encrypted.ast)).toBe(true)
    expect(hasEncryption(encrypted.annotate({ title: "copy" }).ast)).toBe(true)
    expect(hasEncryption(encrypted.pipe(Schema.optionalKey).ast)).toBe(true)
    for (const schema of [
      encrypted,
      Schema.Struct({ value: encrypted.annotate({ title: "copy" }) }),
      Schema.Array(encrypted),
      Schema.Union([Schema.String, encrypted]),
      Payload.protected(Envelope)
    ]) {
      expectSetupFailure(failedSetup(schema), "nested-encryption")
    }
    expectSetupFailure(failedSetup(Schema.String, encrypted), "nested-encryption")
  })

  it("rejects unsupported envelopes and suspended domains without evaluating recursion", () => {
    let suspended = 0
    const recursive = Schema.suspend(() => {
      suspended++
      return Schema.String
    })
    expectSetupFailure(failedSetup(recursive), "recursive-schema")
    expect(suspended).toBe(0)
    for (const envelope of [
      Schema.String,
      Schema.Struct({ fingerprint: Schema.String.pipe(Schema.optionalKey) }),
      Schema.Struct({ fingerprint: Schema.String, amount: Schema.NumberFromString }),
      Schema.Struct({
        fingerprint: Schema.String,
        values: Schema.Tuple([Schema.String])
      }),
      Schema.Struct({
        fingerprint: Schema.String,
        values: Schema.Record(Schema.String, Schema.String)
      })
    ]) {
      expectSetupFailure(failedSetup(Schema.String, envelope), "invalid-envelope")
    }
  })

  it("uses fresh ancestor state for shared AST nodes and repeated executions", () => {
    const shared = Schema.Struct({ value: Schema.String })
    const setup = Payload.encrypted({
      schema: Schema.Struct({ first: shared, second: shared }),
      codec: {
        envelope: Envelope,
        seal: () => Effect.die("unused"),
        open: () => Effect.die("unused")
      }
    })
    expect(Exit.isSuccess(Effect.runSyncExit(setup))).toBe(true)
    expect(Exit.isSuccess(Effect.runSyncExit(setup))).toBe(true)
  })

  it("constructs without key lookup and leaves services to encoding and decoding", async () => {
    class Keys extends Context.Service<Keys, { readonly prefix: string }>()(
      "setup/Keys"
    ) {}
    let operations = 0
    const configured = {
      envelope: Envelope,
      seal: (value: string) =>
        Effect.map(Keys, (keys) => {
          operations++
          return { ciphertext: `${keys.prefix}${value}`, fingerprint: "stable" }
        }),
      open: (value: typeof Envelope.Type) =>
        Effect.map(Keys, (keys) => {
          operations++
          return value.ciphertext.slice(keys.prefix.length)
        })
    }
    const encrypted = Effect.runSync(
      Payload.encrypted({ schema: Schema.String, codec: configured })
    )
    expect(operations).toBe(0)
    const keys = Layer.succeed(Keys, { prefix: "sealed:" })
    const artifact = await Effect.runPromise(
      encodeJobPayload(encrypted, "domain").pipe(Effect.provide(keys))
    )
    expect(new TextDecoder().decode(artifact.payloadBytes)).toBe(
      '{"ciphertext":"sealed:domain","fingerprint":"stable"}'
    )
    expect(
      await Effect.runPromise(
        decodeJobPayload(encrypted, artifact).pipe(Effect.provide(keys))
      )
    ).toBe("domain")
    expect(operations).toBe(2)
  })
})
