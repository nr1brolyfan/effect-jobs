import assert from "node:assert/strict"
import { Context, Effect, Schema, SchemaGetter } from "effect"
import { it } from "vitest"
import { JobPayloadCodecError, type EncodedJobPayload } from "../../../src/JobContract.js"
import * as JobPayload from "../../../src/JobPayload.js"
import { decodeJobPayload, encodeJobPayload } from "../../../src/JobPayloadCodec.js"

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bytes = (value: string) => new TextEncoder().encode(value)
const artifact = (payload: string, projection = payload): EncodedJobPayload => ({
  formatVersion: 1,
  payloadBytes: bytes(payload),
  semanticProjectionBytes: bytes(projection)
})
const failure = async <A>(
  effect: Effect.Effect<A, JobPayloadCodecError>,
  reason: JobPayloadCodecError["reason"]
) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  assert.ok(error instanceof JobPayloadCodecError)
  assert.equal(error.reason, reason)
  assert.equal(JSON.stringify(error).includes("PRIVATE"), false)
  assert.equal(String(error).includes("PRIVATE"), false)
}
const Protected = JobPayload.protected(
  Schema.Struct({
    ciphertext: Schema.String,
    fingerprint: Schema.Struct({ keyId: Schema.String, value: Schema.String })
  })
)
const protectedValue = (ciphertext = "random-one", value = "stable") => ({
  ciphertext,
  fingerprint: { keyId: "fingerprint-key", value }
})

it("emits exact canonical golden bytes, locale-independent keys, finite fractions and array order", async () => {
  const a = await Effect.runPromise(
    encodeJobPayload(Schema.Unknown, { z: 1.5, a: [true, null, -0], Z: "é" })
  )
  const b = await Effect.runPromise(
    encodeJobPayload(Schema.Unknown, { Z: "é", a: [true, null, 0], z: 1.5 })
  )
  assert.equal(a.formatVersion, 1)
  assert.equal(text(a.payloadBytes), '{"Z":"é","a":[true,null,0],"z":1.5}')
  assert.deepEqual(a.payloadBytes, b.payloadBytes)
  assert.deepEqual(a.payloadBytes, a.semanticProjectionBytes)
  assert.notEqual(a.payloadBytes, a.semanticProjectionBytes)
  assert.deepEqual(await Effect.runPromise(decodeJobPayload(Schema.Unknown, a)), {
    Z: "é",
    a: [true, null, 0],
    z: 1.5
  })
  const reversed = await Effect.runPromise(
    encodeJobPayload(Schema.Unknown, { Z: "é", a: [null, true, 0], z: 1.5 })
  )
  assert.notDeepEqual(a.semanticProjectionBytes, reversed.semanticProjectionBytes)
  for (const value of [Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER + 1]) {
    const encoded = await Effect.runPromise(encodeJobPayload(Schema.Number, value))
    assert.equal(await Effect.runPromise(decodeJobPayload(Schema.Number, encoded)), value)
  }
})

it("projects selected Union branches through structs, arrays and optional fields (qualified auth regression)", async () => {
  const Item = Schema.Union([
    Schema.Struct({ tag: Schema.Literal("public"), value: Schema.String }),
    Schema.Struct({ tag: Schema.Literal("secret"), value: Protected })
  ])
  const Payload = Schema.Struct({
    items: Schema.Array(Item),
    extra: Schema.optionalKey(Protected)
  })
  const input = {
    items: [
      { tag: "public" as const, value: "visible" },
      { tag: "secret" as const, value: protectedValue() }
    ]
  }
  const a = await Effect.runPromise(encodeJobPayload(Payload, input))
  const b = await Effect.runPromise(
    encodeJobPayload(Payload, {
      items: [input.items[0]!, { tag: "secret", value: protectedValue("random-two") }]
    })
  )
  assert.notDeepEqual(a.payloadBytes, b.payloadBytes)
  assert.deepEqual(a.semanticProjectionBytes, b.semanticProjectionBytes)
  assert.equal(
    text(a.semanticProjectionBytes),
    '{"items":[{"tag":"public","value":"visible"},{"tag":"secret","value":{"$protected":{"fingerprint":{"keyId":"fingerprint-key","value":"stable"},"path":"/items/1/value"}}}]}'
  )
  assert.deepEqual(await Effect.runPromise(decodeJobPayload(Payload, a)), input)
  for (const changed of [
    { ...input, extra: protectedValue() },
    {
      items: [
        input.items[0]!,
        { tag: "secret" as const, value: protectedValue("random-one", "changed") }
      ]
    },
    { items: [{ tag: "public" as const, value: "changed" }, input.items[1]!] }
  ]) {
    const encoded = await Effect.runPromise(encodeJobPayload(Payload, changed))
    assert.notDeepEqual(a.semanticProjectionBytes, encoded.semanticProjectionBytes)
  }
  const publicOnly = await Effect.runPromise(
    encodeJobPayload(Item, { tag: "public", value: "visible" })
  )
  assert.deepEqual(publicOnly.payloadBytes, publicOnly.semanticProjectionBytes)
})

it("requires own canonical fingerprints, ignores all other protected bytes, and escapes schema paths", async () => {
  const P = JobPayload.protected(Schema.Unknown)
  for (const fingerprint of [undefined, NaN, Infinity, 1n, new Date(), "\ud800"]) {
    await failure(
      encodeJobPayload(P, { fingerprint, ciphertext: "PRIVATE" }),
      "invalid-json-value"
    )
  }
  await failure(encodeJobPayload(P, { ciphertext: "PRIVATE" }), "invalid-protected-value")
  const inherited = Object.create({ fingerprint: "stable" }) as unknown
  await failure(encodeJobPayload(P, inherited), "invalid-protected-value")
  let accessed = false
  const exotic = Object.defineProperty(Object.create({}), "fingerprint", {
    enumerable: true,
    get: () => {
      accessed = true
      return "PRIVATE"
    }
  })
  await failure(encodeJobPayload(P, exotic), "invalid-json-value")
  assert.equal(accessed, false)
  const Payload = Schema.Struct({ "a~/b": P })
  const a = await Effect.runPromise(
    encodeJobPayload(Payload, {
      "a~/b": { fingerprint: { z: 1.5, a: true }, arbitrary: "one" }
    })
  )
  const b = await Effect.runPromise(
    encodeJobPayload(Payload, {
      "a~/b": { fingerprint: { a: true, z: 1.5 }, arbitrary: { other: "two" } }
    })
  )
  assert.deepEqual(a.semanticProjectionBytes, b.semanticProjectionBytes)
  assert.equal(
    text(a.semanticProjectionBytes),
    '{"a~/b":{"$protected":{"fingerprint":{"a":true,"z":1.5},"path":"/a~0~1b"}}}'
  )
  await failure(
    encodeJobPayload(Protected, {
      ciphertext: "PRIVATE",
      fingerprint: { keyId: "x", value: 3 }
    } as never),
    "invalid-schema"
  )
})

it("preserves the original root Union regression oracle and optional marked fields", async () => {
  const Payload = Schema.Union([
    Schema.Struct({ tag: Schema.Literal("public"), value: Schema.String }),
    Schema.Struct({
      tag: Schema.Literal("secret"),
      label: Schema.String,
      value: Protected
    })
  ])
  const input = { tag: "secret" as const, label: "original", value: protectedValue() }
  const encoded = await Effect.runPromise(encodeJobPayload(Payload, input))
  const reencrypted = await Effect.runPromise(
    encodeJobPayload(Payload, { ...input, value: protectedValue("random-two") })
  )
  assert.notDeepEqual(encoded.payloadBytes, reencrypted.payloadBytes)
  assert.deepEqual(encoded.semanticProjectionBytes, reencrypted.semanticProjectionBytes)
  assert.equal(
    text(encoded.semanticProjectionBytes),
    '{"label":"original","tag":"secret","value":{"$protected":{"fingerprint":{"keyId":"fingerprint-key","value":"stable"},"path":"/value"}}}'
  )
  for (const changed of [
    { ...input, label: "changed" },
    { ...input, value: protectedValue("random-one", "changed") }
  ]) {
    const result = await Effect.runPromise(encodeJobPayload(Payload, changed))
    assert.notDeepEqual(encoded.semanticProjectionBytes, result.semanticProjectionBytes)
  }
  const Optional = Schema.Struct({ value: Schema.optional(Protected) })
  const omitted = await Effect.runPromise(encodeJobPayload(Optional, {}))
  assert.equal(text(omitted.payloadBytes), "{}")
  const present = await Effect.runPromise(
    encodeJobPayload(Optional, { value: protectedValue() })
  )
  assert.deepEqual(await Effect.runPromise(decodeJobPayload(Optional, present)), {
    value: protectedValue()
  })
  // Present undefined is not a JSON value: optional means an absent key on wire.
  await failure(encodeJobPayload(Optional, { value: undefined }), "invalid-json-value")
})

it("rejects cycles, nonfinite/non-JSON values, arbitrary objects, accessors and excess properties", async () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const sparse: Array<string> = []
  sparse.length = 1
  const accessor = Object.defineProperty({}, "x", {
    enumerable: true,
    get: () => {
      throw new Error("PRIVATE")
    }
  })
  const hidden = Object.defineProperty({}, "x", { value: "PRIVATE" })
  const symbol = { [Symbol("PRIVATE")]: 1 }
  const toJSON = { toJSON: () => "PRIVATE" }
  for (const value of [
    undefined,
    NaN,
    Infinity,
    -Infinity,
    1n,
    () => 1,
    Symbol(),
    cyclic,
    sparse,
    accessor,
    hidden,
    symbol,
    toJSON,
    new Date(),
    new Map(),
    "\ud800"
  ]) {
    await failure(encodeJobPayload(Schema.Unknown, value), "invalid-json-value")
  }
  await failure(
    encodeJobPayload(Schema.Struct({ x: Schema.String }), {
      x: "ok",
      private: "PRIVATE"
    } as never),
    "invalid-schema"
  )
  class Arbitrary {
    x = "PRIVATE"
  }
  await failure(
    encodeJobPayload(Schema.Struct({ x: Schema.String }), new Arbitrary()),
    "invalid-json-value"
  )
  const extraArray = Object.assign(["ok"], { extra: "PRIVATE" })
  await failure(
    encodeJobPayload(Schema.Array(Schema.String), extraArray),
    "invalid-json-value"
  )
  await failure(
    encodeJobPayload(Schema.Array(Schema.String), sparse),
    "invalid-json-value"
  )
  const nullPrototype = Object.assign(Object.create(null), { x: "ok" })
  const encoded = await Effect.runPromise(encodeJobPayload(Schema.Unknown, nullPrototype))
  assert.equal(text(encoded.payloadBytes), '{"x":"ok"}')
})

it("enforces precise payload/projection byte, depth, subtree count and UTF-8 path bounds", async () => {
  const exact = await Effect.runPromise(
    encodeJobPayload(Schema.String, "x".repeat(65534))
  )
  assert.equal(exact.payloadBytes.length, 65536)
  await failure(encodeJobPayload(Schema.String, "x".repeat(65535)), "payload-too-large")
  const multi = await Effect.runPromise(
    encodeJobPayload(Schema.String, "é".repeat(32767))
  )
  assert.equal(multi.payloadBytes.length, 65536)
  await failure(encodeJobPayload(Schema.String, "é".repeat(32768)), "payload-too-large")
  const deep = (depth: number) => {
    let value: unknown = null
    for (let i = 0; i < depth; i++) {
      value = [value]
    }
    return value
  }
  const deepest = await Effect.runPromise(encodeJobPayload(Schema.Unknown, deep(32)))
  await Effect.runPromise(decodeJobPayload(Schema.Unknown, deepest))
  await failure(encodeJobPayload(Schema.Unknown, deep(33)), "payload-too-deep")
  await failure(
    decodeJobPayload(Schema.Unknown, artifact(JSON.stringify(deep(33)))),
    "payload-too-deep"
  )
  const ArrayPayload = Schema.Array(Protected)
  const sixteen = await Effect.runPromise(
    encodeJobPayload(
      ArrayPayload,
      Array.from({ length: 16 }, () => protectedValue())
    )
  )
  await Effect.runPromise(decodeJobPayload(ArrayPayload, sixteen))
  await failure(
    encodeJobPayload(
      ArrayPayload,
      Array.from({ length: 17 }, () => protectedValue())
    ),
    "too-many-protected-subtrees"
  )
  await failure(
    decodeJobPayload(
      ArrayPayload,
      artifact(
        JSON.stringify(
          Array.from({ length: 17 }, () => ({
            ciphertext: "a",
            fingerprint: { keyId: "x", value: "x" }
          }))
        )
      )
    ),
    "too-many-protected-subtrees"
  )
  for (const key of ["x".repeat(255), "é".repeat(127) + "x"]) {
    const S = Schema.Struct({ [key]: Protected })
    const encoded = await Effect.runPromise(
      encodeJobPayload(S, { [key]: protectedValue() })
    )
    await Effect.runPromise(decodeJobPayload(S, encoded))
  }
  for (const key of ["x".repeat(256), "é".repeat(128), "~".repeat(128)]) {
    await failure(
      encodeJobPayload(Schema.Struct({ [key]: Protected }), { [key]: protectedValue() }),
      "schema-path-too-long"
    )
  }
  const RootProtected = JobPayload.protected(
    Schema.Struct({ fingerprint: Schema.String })
  )
  const overhead = bytes('{"$protected":{"fingerprint":"","path":""}}').length
  const projected = await Effect.runPromise(
    encodeJobPayload(RootProtected, { fingerprint: "x".repeat(65536 - overhead) })
  )
  assert.equal(projected.semanticProjectionBytes.length, 65536)
  await failure(
    encodeJobPayload(RootProtected, { fingerprint: "x".repeat(65537 - overhead) }),
    "projection-too-large"
  )
})

it("rejects malformed, noncanonical, invalid schema and inconsistent decode artifacts", async () => {
  for (const payload of [
    "{",
    "undefined",
    "NaN",
    '{"x":1,"x":2}',
    ' {"x":1}',
    '{"z":1,"a":2}',
    '"\\ud800"',
    "\ufeffnull",
    "1e999",
    "-0"
  ]) {
    const reason =
      payload === "1e999" || payload === '"\\ud800"'
        ? "invalid-json-value"
        : "invalid-encoding"
    await failure(decodeJobPayload(Schema.Unknown, artifact(payload)), reason)
  }
  await failure(
    decodeJobPayload(Schema.Unknown, {
      ...artifact("null"),
      payloadBytes: new Uint8Array([0xff])
    }),
    "invalid-encoding"
  )
  await failure(
    decodeJobPayload(Schema.Unknown, { ...artifact("null"), formatVersion: 2 } as never),
    "invalid-encoding"
  )
  await failure(
    decodeJobPayload(Schema.Unknown, {
      ...artifact("null"),
      payloadBytes: new Uint8Array(65537)
    }),
    "payload-too-large"
  )
  await failure(
    decodeJobPayload(Schema.Unknown, {
      ...artifact("null"),
      semanticProjectionBytes: new Uint8Array(65537)
    }),
    "projection-too-large"
  )
  await failure(decodeJobPayload(Schema.String, artifact("42")), "invalid-schema")
  await failure(
    decodeJobPayload(
      Schema.Struct({ x: Schema.String }),
      artifact('{"extra":"PRIVATE","x":"ok"}')
    ),
    "invalid-schema"
  )
  await failure(
    decodeJobPayload(Schema.Unknown, artifact("null", "true")),
    "projection-mismatch"
  )
  await failure(
    decodeJobPayload(Schema.Unknown, artifact("null", "{")),
    "invalid-encoding"
  )
  const encoded = await Effect.runPromise(encodeJobPayload(Protected, protectedValue()))
  await failure(
    decodeJobPayload(Protected, {
      ...encoded,
      semanticProjectionBytes: encoded.payloadBytes
    }),
    "projection-mismatch"
  )
  await failure(
    decodeJobPayload(
      JobPayload.protected(Schema.Unknown),
      artifact('{"ciphertext":"PRIVATE"}')
    ),
    "invalid-protected-value"
  )
  const path = "x".repeat(256)
  const pathPayload = JSON.stringify({
    [path]: { ciphertext: "a", fingerprint: { keyId: "x", value: "x" } }
  })
  await failure(
    decodeJobPayload(Schema.Struct({ [path]: Protected }), artifact(pathPayload)),
    "schema-path-too-long"
  )
})

it("does not invoke domain decoding when projection or encoded schema is invalid", async () => {
  let decoded = 0
  const Payload = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value) => {
        decoded++
        return value
      }),
      encode: SchemaGetter.transform((value) => value)
    })
  )
  await failure(
    decodeJobPayload(Payload, artifact('"PRIVATE"', '"mismatch"')),
    "projection-mismatch"
  )
  await failure(decodeJobPayload(Payload, artifact("42")), "invalid-schema")
  assert.equal(decoded, 0)
  assert.equal(
    await Effect.runPromise(decodeJobPayload(Payload, artifact('"valid"'))),
    "valid"
  )
  assert.equal(decoded, 1)
})

it("persists validated encoded domain transforms, explicitly rejects unsupported mappings", async () => {
  const Payload = Schema.Struct({ amount: Schema.NumberFromString })
  const encoded = await Effect.runPromise(encodeJobPayload(Payload, { amount: 1.5 }))
  assert.equal(text(encoded.payloadBytes), '{"amount":"1.5"}')
  assert.deepEqual(await Effect.runPromise(decodeJobPayload(Payload, encoded)), {
    amount: 1.5
  })
  for (const value of [NaN, Infinity, -Infinity]) {
    await failure(encodeJobPayload(Schema.NumberFromString, value), "invalid-json-value")
    await failure(
      decodeJobPayload(Schema.NumberFromString, artifact(JSON.stringify(String(value)))),
      "invalid-json-value"
    )
  }
  const DatePayload = Schema.Struct({ date: Schema.DateFromString })
  const bigint = 9007199254740993n
  const bigintEncoded = await Effect.runPromise(
    encodeJobPayload(Schema.BigIntFromString, bigint)
  )
  assert.equal(text(bigintEncoded.payloadBytes), '"9007199254740993"')
  assert.equal(
    await Effect.runPromise(decodeJobPayload(Schema.BigIntFromString, bigintEncoded)),
    bigint
  )
  const date = new Date("2026-10-04T00:00:00.000Z")
  const dateEncoded = await Effect.runPromise(encodeJobPayload(DatePayload, { date }))
  assert.deepEqual(await Effect.runPromise(decodeJobPayload(DatePayload, dateEncoded)), {
    date
  })
  const TransformedFingerprint = JobPayload.protected(
    Schema.Struct({ ciphertext: Schema.String, fingerprint: Schema.NumberFromString })
  )
  const transformed = await Effect.runPromise(
    encodeJobPayload(TransformedFingerprint, { ciphertext: "random", fingerprint: 1.5 })
  )
  assert.equal(
    text(transformed.semanticProjectionBytes),
    '{"$protected":{"fingerprint":"1.5","path":""}}'
  )
  assert.deepEqual(
    await Effect.runPromise(decodeJobPayload(TransformedFingerprint, transformed)),
    { ciphertext: "random", fingerprint: 1.5 }
  )
  const transform = Schema.String.pipe(
    Schema.decodeTo(Protected, {
      decode: SchemaGetter.transform(() => protectedValue()),
      encode: SchemaGetter.transform(() => "PRIVATE")
    })
  )
  const recursive = Schema.suspend(() => Schema.Struct({ value: Protected }))
  for (const schema of [
    Schema.Tuple([Protected]),
    recursive,
    transform,
    JobPayload.protected(Schema.NumberFromString),
    Schema.Record(Schema.String, Protected),
    Schema.declare((value): value is object => typeof value === "object")
  ]) {
    await failure(encodeJobPayload(schema, {} as never), "invalid-schema")
    await failure(decodeJobPayload(schema, artifact("{}")), "invalid-schema")
  }
})

class Encoding extends Context.Service<Encoding, { readonly prefix: string }>()(
  "tests/codec/Encoding"
) {}
class Decoding extends Context.Service<Decoding, { readonly prefix: string }>()(
  "tests/codec/Decoding"
) {}
const Serviced = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transformEffect((value) =>
      Effect.gen(function* () {
        const { prefix } = yield* Decoding
        return Number(value.slice(prefix.length))
      })
    ),
    encode: SchemaGetter.transformEffect((value) =>
      Effect.gen(function* () {
        const { prefix } = yield* Encoding
        return `${prefix}${value}`
      })
    )
  })
)

it("propagates separate runtime services and snapshots artifacts before application yields", async () => {
  const encoded = await Effect.runPromise(
    encodeJobPayload(Serviced, 1.5).pipe(
      Effect.provideService(Encoding, { prefix: "n:" })
    )
  )
  assert.equal(text(encoded.payloadBytes), '"n:1.5"')
  assert.equal(
    await Effect.runPromise(
      decodeJobPayload(Serviced, encoded).pipe(
        Effect.provideService(Decoding, { prefix: "n:" })
      )
    ),
    1.5
  )
  const Snapshot = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((value) =>
        Effect.sync(() => {
          encoded.payloadBytes.fill(0)
          encoded.semanticProjectionBytes.fill(0)
          return value
        })
      ),
      encode: SchemaGetter.transform((value) => value)
    })
  )
  assert.equal(await Effect.runPromise(decodeJobPayload(Snapshot, encoded)), "n:1.5")
  const first = await Effect.runPromise(
    encodeJobPayload(Schema.Unknown, { value: "before" })
  )
  first.payloadBytes.fill(0)
  assert.equal(text(first.semanticProjectionBytes), '{"value":"before"}')
  const next = await Effect.runPromise(
    encodeJobPayload(Schema.Unknown, { value: "before" })
  )
  assert.equal(text(next.payloadBytes), '{"value":"before"}')
})
