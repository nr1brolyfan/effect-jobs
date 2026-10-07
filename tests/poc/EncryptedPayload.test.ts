import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { Context, Effect, Layer, Logger, Schema, SchemaAST } from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Codec from "../../src/JobPayloadCodec.js"
import * as Policy from "../../src/JobPolicy.js"
import { JobPayloadCodecError } from "../../src/JobContract.js"
import { JobFailures } from "../../src/JobFailure.js"
import { JobRegistry, layer as registryLayer } from "../../src/JobRegistry.js"
import { canonicalText } from "../../src/internal/codec/CanonicalJson.js"
import { project } from "../../src/internal/codec/ProtectedProjection.js"
import { executionFor } from "../../src/internal/worker/Execution.js"
import { harness } from "../core/worker/Harness.js"
import {
  containsUnavailable,
  encrypted,
  native,
  ProtectionFailure
} from "./EncryptedPayload.js"
import type { EncryptionCodec } from "./EncryptedPayload.js"
import type { EncodedJobPayload, PreparedJob } from "../../src/JobContract.js"

const Envelope = Schema.Struct({
  keyId: Schema.String,
  ciphertext: Schema.String,
  fingerprint: Schema.String
})
const Document = Schema.Struct({
  recipient: Schema.NonEmptyString,
  amount: Schema.FiniteFromString.pipe(Schema.check(Schema.isGreaterThan(0)))
})
type DocumentEncoded = typeof Document.Encoded
type EnvelopeValue = typeof Envelope.Type
interface Keys {
  readonly seal: (
    value: DocumentEncoded
  ) => Effect.Effect<EnvelopeValue, ProtectionFailure>
  readonly open: (
    envelope: EnvelopeValue
  ) => Effect.Effect<DocumentEncoded, ProtectionFailure>
}
class ReceiptKeys extends Context.Service<ReceiptKeys, Keys>()("poc/ReceiptKeys") {}
class PersonalKeys extends Context.Service<PersonalKeys, Keys>()("poc/PersonalKeys") {}

/** Opaque random token storage is a STUB, not encryption. HMAC keys are synthetic
 * test fixtures. No cryptographic security/AAD/KMS qualification is claimed. */
const keyFixture = (namespace: string) => {
  const values = new Map<string, { keyId: string; value: DocumentEncoded }>()
  let activeKeyId = "v1"
  let unavailable = false
  let seals = 0
  let opens = 0
  const service: Keys = {
    seal: (value) =>
      Effect.suspend(() => {
        if (unavailable) {
          return Effect.fail(new ProtectionFailure({ reason: "key-unavailable" }))
        }
        assert.equal(typeof value.amount, "string")
        const ciphertext = randomUUID()
        seals++
        values.set(ciphertext, { keyId: activeKeyId, value })
        return Effect.succeed({
          keyId: activeKeyId,
          ciphertext,
          fingerprint: createHmac(
            "sha256",
            `synthetic-stable-fingerprint-key:${namespace}`
          )
            .update(canonicalText(value, 65_536, "payload-too-large"))
            .digest("hex")
        })
      }),
    open: (envelope) =>
      Effect.suspend(() => {
        opens++
        if (unavailable) {
          return Effect.fail(new ProtectionFailure({ reason: "key-unavailable" }))
        }
        const stored = values.get(envelope.ciphertext)
        if (stored === undefined || stored.keyId !== envelope.keyId) {
          return Effect.fail(new ProtectionFailure({ reason: "invalid-envelope" }))
        }
        return Effect.succeed(stored.value)
      })
  }
  return {
    service,
    rotate: () => {
      activeKeyId = "v2"
    },
    outage: (value: boolean) => {
      unavailable = value
    },
    invalidDomain: (envelope: EnvelopeValue) => {
      values.set(envelope.ciphertext, {
        keyId: envelope.keyId,
        value: { recipient: "", amount: "1" }
      })
    },
    counts: () => ({ seals, opens })
  }
}
const ReceiptCodec: EncryptionCodec<
  DocumentEncoded,
  typeof Envelope,
  ReceiptKeys,
  ReceiptKeys
> = {
  envelope: Envelope,
  seal: (value) => Effect.flatMap(ReceiptKeys, (keys) => keys.seal(value)),
  open: (value) => Effect.flatMap(ReceiptKeys, (keys) => keys.open(value))
}
const PersonalCodec: EncryptionCodec<
  DocumentEncoded,
  typeof Envelope,
  PersonalKeys,
  PersonalKeys
> = {
  envelope: Envelope,
  seal: (value) => Effect.flatMap(PersonalKeys, (keys) => keys.seal(value)),
  open: (value) => Effect.flatMap(PersonalKeys, (keys) => keys.open(value))
}
export const PrivateDocument = encrypted({ schema: Document, codec: ReceiptCodec })
export const Payload = Schema.Struct({
  invoiceId: Schema.String,
  document: PrivateDocument
})
const input = {
  invoiceId: "synthetic-invoice",
  document: { recipient: "synthetic-recipient", amount: 12.5 }
}
const strict = { onExcessProperty: "error" } as const

it("native schema composes encoded-domain seal/open with validation and lazy services", async () => {
  const keys = keyFixture("receipt")
  const program = Effect.gen(function* () {
    assert.deepEqual(keys.counts(), { seals: 0, opens: 0 })
    const encoded = yield* Schema.encodeEffect(Payload, strict)(input)
    assert.equal(encoded.invoiceId, input.invoiceId)
    assert.equal(Object.hasOwn(encoded.document, "recipient"), false)
    assert.deepEqual(yield* Schema.decodeEffect(Payload, strict)(encoded), input)
    const invalid = yield* Schema.encodeEffect(
      Payload,
      strict
    )({ ...input, document: { recipient: "", amount: 12.5 } }).pipe(Effect.result)
    assert.equal(invalid._tag, "Failure")
    assert.equal(keys.counts().seals, 1)
    for (const document of [
      { ...encoded.document, keyId: "wrong-key" },
      { ...encoded.document, ciphertext: "tampered" },
      { keyId: "v1" }
    ]) {
      const result = yield* Schema.decodeUnknownEffect(
        Payload,
        strict
      )({ ...encoded, document }).pipe(Effect.result)
      assert.equal(result._tag, "Failure")
    }
    keys.invalidDomain(encoded.document)
    const invalidOpened = yield* Schema.decodeEffect(
      Payload,
      strict
    )(encoded).pipe(Effect.result)
    assert.equal(invalidOpened._tag, "Failure")
  })
  await Effect.runPromise(
    program.pipe(Effect.provide(Layer.succeed(ReceiptKeys, keys.service)))
  )
})

it("native structs, optional fields, arrays and discriminated unions retain independent field services", async () => {
  const first = keyFixture("receipt")
  const second = keyFixture("personal")
  const personal = encrypted({ schema: Document, codec: PersonalCodec })
  const schemas = [
    Schema.Struct({ document: PrivateDocument, personal }),
    Schema.Struct({
      nested: Schema.Struct({ document: PrivateDocument }),
      absent: Schema.optional(personal)
    }),
    Schema.Array(PrivateDocument),
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("private"), document: PrivateDocument }),
      Schema.Struct({ kind: Schema.Literal("public"), note: Schema.String })
    ])
  ] as const
  const values = [
    { document: input.document, personal: { recipient: "synthetic-other", amount: 1 } },
    { nested: { document: input.document } },
    [input.document, input.document],
    { kind: "private", document: input.document }
  ] as const
  // Dynamic matrix runs as unknown; the concrete schema/service types are qualified separately.
  const program = Effect.gen(function* () {
    for (let index = 0; index < schemas.length; index++) {
      const schema = schemas[index]!
      const encoded = yield* Schema.encodeUnknownEffect(schema, strict)(values[index])
      assert.deepEqual(
        yield* Schema.decodeUnknownEffect(schema, strict)(encoded),
        values[index]
      )
      const projection = yield* project(SchemaAST.toEncoded(schema.ast), encoded)
      assert.equal(
        canonicalText(projection, 65_536, "projection-too-large").includes(
          "synthetic-recipient"
        ),
        false
      )
    }
    const publicValue = { kind: "public", note: "synthetic-public" } as const
    const publicWire = yield* Schema.encodeEffect(schemas[3], strict)(publicValue)
    assert.deepEqual(
      yield* Schema.decodeEffect(schemas[3], strict)(publicWire),
      publicValue
    )
    const dual = yield* Schema.encodeEffect(schemas[0], strict)(values[0])
    const swapped = yield* Schema.decodeEffect(
      schemas[0],
      strict
    )({ document: dual.personal, personal: dual.document }).pipe(Effect.result)
    assert.equal(swapped._tag, "Failure")
    assert.equal(second.counts().seals, 2)
  })
  await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ReceiptKeys, first.service),
          Layer.succeed(PersonalKeys, second.service)
        )
      )
    )
  )
  assert.throws(
    () =>
      encrypted({
        schema: Schema.Struct({ document: PrivateDocument }),
        codec: {
          envelope: Envelope,
          seal: () => Effect.die("nested seal must never execute"),
          open: () => Effect.die("nested open must never execute")
        }
      }),
    /encrypted-within-encrypted/
  )
})

it("encoded protected projection remains stable across random ciphertext and key rotation, changes with content", async () => {
  const keys = keyFixture("receipt")
  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* Schema.encodeEffect(Payload, strict)(input)
      keys.rotate()
      const second = yield* Schema.encodeEffect(Payload, strict)(input)
      assert.notEqual(first.document.ciphertext, second.document.ciphertext)
      assert.notEqual(first.document.keyId, second.document.keyId)
      const ast = SchemaAST.toEncoded(Payload.ast)
      const projection = (wire: typeof Payload.Encoded) =>
        project(ast, wire).pipe(
          Effect.map((value) => canonicalText(value, 65_536, "projection-too-large"))
        )
      assert.equal(yield* projection(first), yield* projection(second))
      assert.deepEqual(yield* Schema.decodeEffect(Payload, strict)(first), input)
      const changed = yield* Schema.encodeEffect(
        Payload,
        strict
      )({ ...input, document: { ...input.document, amount: 13 } })
      assert.notEqual(yield* projection(first), yield* projection(changed))
      const current = yield* Codec.encodeJobPayload(Payload, input).pipe(Effect.result)
      assert.equal(current._tag, "Failure")
      if (current._tag === "Failure") {
        assert.deepEqual(
          current.failure,
          new JobPayloadCodecError({ reason: "invalid-schema" })
        )
      }
    }).pipe(Effect.provide(Layer.succeed(ReceiptKeys, keys.service)))
  )
})

/** Control without protection annotation: isolates the existing decoder/lifecycle
 * classification from the separate current unsupported-projection failure. */
const UnmarkedPayload = Schema.Struct({
  invoiceId: Schema.String,
  document: native({ schema: Document, codec: ReceiptCodec }, false)
})
const definition = Job.make({
  queue: Queue.make("poc"),
  kind: "encrypted.document",
  version: 1,
  payload: UnmarkedPayload,
  encodePayload: Codec.encodeJobPayload
})
const artifact = (wire: unknown): EncodedJobPayload => {
  const json = canonicalText(wire, 65_536, "payload-too-large")
  return {
    formatVersion: 1,
    payloadBytes: new TextEncoder().encode(json),
    semanticProjectionBytes: new TextEncoder().encode(
      canonicalText({ data: wire, protected: {} }, 65_536, "projection-too-large", -1)
    )
  }
}

for (const mode of [
  "valid",
  "malformed",
  "tampered",
  "invalid-domain",
  "unavailable"
] as const) {
  it(`current registry/worker control: ${mode}`, async () => {
    const keys = keyFixture("receipt")
    let handlerCalls = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const wire = yield* Schema.encodeEffect(UnmarkedPayload, strict)(input)
        if (mode === "unavailable") {
          keys.outage(true)
        }
        if (mode === "invalid-domain") {
          keys.invalidDomain(wire.document)
        }
        const changed =
          mode === "tampered"
            ? { ...wire, document: { ...wire.document, ciphertext: "tampered" } }
            : mode === "malformed"
              ? { ...wire, document: { keyId: "v1" } }
              : wire
        const encoded = artifact(changed)
        if (mode === "unavailable") {
          const nativeError = yield* Schema.decodeEffect(
            UnmarkedPayload,
            strict
          )(wire).pipe(Effect.result)
          assert.equal(nativeError._tag, "Failure")
          if (nativeError._tag === "Failure") {
            assert.equal(containsUnavailable(nativeError.failure), true)
          }
          const collapsed = yield* Codec.decodeJobPayload(UnmarkedPayload, encoded).pipe(
            Effect.result
          )
          assert.equal(collapsed._tag, "Failure")
          if (collapsed._tag === "Failure") {
            assert.deepEqual(
              collapsed.failure,
              new JobPayloadCodecError({ reason: "invalid-schema" })
            )
            assert.equal(containsUnavailable(collapsed.failure), false)
          }
        }
        const prepared: PreparedJob = {
          catalog: definition.catalog,
          producer: {
            operation: "poc.issue",
            operationId: "synthetic-operation",
            slot: "document"
          },
          policy: Policy.make(),
          encoded
        }
        const test = harness([prepared])
        yield* Layer.build(
          definition.handlerLayer(
            ({ payload }) =>
              Effect.sync(() => {
                handlerCalls++
                assert.deepEqual(payload, input)
              }),
            Codec.decodeJobPayload
          )
        )
        const registry = yield* JobRegistry
        const claim = yield* test.store.claim({
          queue: definition.queue.name,
          supportedCatalog: [definition.catalog],
          leaseToken: "00000000-0000-4000-8000-000000000001"
        })
        assert.equal(claim._tag, "Claimed")
        if (claim._tag !== "Claimed") {
          return
        }
        yield* executionFor(
          test.store,
          claim.claim,
          registry.find,
          [definition.catalog],
          100
        )
        assert.equal(handlerCalls, mode === "valid" ? 1 : 0)
        assert.equal(
          test.rows[0]!.snapshot.state,
          mode === "valid" ? "Completed" : "Isolated"
        )
        assert.equal(test.rows[0]!.snapshot.attemptsMade, 1)
        if (mode !== "valid") {
          assert.equal(test.rows[0]!.snapshot.lastFailureCode, "invalid_claimed_artifact")
        }
        if (mode === "unavailable") {
          keys.outage(false)
          yield* TestClock.adjust("2 minutes")
          assert.equal(yield* test.store.recoverExpired(1), 0)
          const afterRecovery = yield* test.store.claim({
            queue: definition.queue.name,
            supportedCatalog: [definition.catalog],
            leaseToken: "00000000-0000-4000-8000-000000000002"
          })
          assert.equal(afterRecovery._tag, "Empty")
          assert.equal(test.rows[0]!.snapshot.state, "Isolated")
          assert.equal(handlerCalls, 0)
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            registryLayer,
            Layer.succeed(ReceiptKeys, keys.service),
            TestClock.layer(),
            Logger.layer([])
          )
        ),
        Effect.scoped
      )
    )
  })
}

for (const maxAttempts of [1, 3]) {
  it(`proposal control: explicit transient decode Retry with maxAttempts=${maxAttempts}`, async () => {
    const keys = keyFixture("receipt")
    let handlerCalls = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const wire = yield* Schema.encodeEffect(UnmarkedPayload, strict)(input)
        keys.outage(true)
        const encoded = artifact(wire)
        const test = harness([
          {
            catalog: definition.catalog,
            producer: {
              operation: "poc.issue",
              operationId: "synthetic-operation",
              slot: "document"
            },
            policy: Policy.make({ maxAttempts }),
            encoded
          }
        ])
        const registry = yield* JobRegistry
        // Test-only adapter: bypass standard decoder to retain native error identity.
        // This demonstrates requested policy, not changed production semantics.
        yield* registry.install({
          catalog: definition.catalog,
          execute: () =>
            Schema.decodeEffect(
              UnmarkedPayload,
              strict
            )(wire).pipe(
              Effect.tap((decoded) =>
                Effect.sync(() => {
                  handlerCalls++
                  assert.deepEqual(decoded, input)
                })
              ),
              Effect.asVoid,
              Effect.mapError((error) =>
                containsUnavailable(error)
                  ? JobFailures.Retry({ code: "payload_key_unavailable" })
                  : new JobPayloadCodecError({ reason: "invalid-schema" })
              ),
              Effect.provideService(ReceiptKeys, keys.service)
            )
        })
        const claim = yield* test.store.claim({
          queue: definition.queue.name,
          supportedCatalog: [definition.catalog],
          leaseToken: "00000000-0000-4000-8000-000000000001"
        })
        assert.equal(claim._tag, "Claimed")
        if (claim._tag !== "Claimed") {
          return
        }
        yield* executionFor(
          test.store,
          claim.claim,
          registry.find,
          [definition.catalog],
          100
        )
        assert.equal(
          test.rows[0]!.snapshot.state,
          maxAttempts === 1 ? "Dead" : "RetryScheduled"
        )
        assert.equal(test.rows[0]!.snapshot.attemptsMade, 1)
        assert.equal(test.rows[0]!.snapshot.stalledCount, 0)
        assert.equal(test.rows[0]!.snapshot.lastFailureCode, "payload_key_unavailable")
        assert.equal(handlerCalls, 0)
        keys.outage(false)
        yield* TestClock.adjust("5 seconds")
        const resumed = yield* test.store.claim({
          queue: definition.queue.name,
          supportedCatalog: [definition.catalog],
          leaseToken: "00000000-0000-4000-8000-000000000002"
        })
        if (maxAttempts === 1) {
          assert.equal(resumed._tag, "Empty")
        } else {
          assert.equal(resumed._tag, "Claimed")
          if (resumed._tag === "Claimed") {
            yield* executionFor(
              test.store,
              resumed.claim,
              registry.find,
              [definition.catalog],
              100
            )
          }
          assert.equal(test.rows[0]!.snapshot.state, "Completed")
          assert.equal(test.rows[0]!.snapshot.attemptsMade, 2)
          assert.equal(handlerCalls, 1)
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            registryLayer,
            Layer.succeed(ReceiptKeys, keys.service),
            TestClock.layer(),
            Logger.layer([])
          )
        ),
        Effect.scoped
      )
    )
  })
}

// Compile-time positive AND negative checks against the installed Effect 4 API.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type True<T extends true> = T
export type DomainType = True<Equal<typeof PrivateDocument.Type, typeof Document.Type>>
export type WireType = True<
  Equal<typeof PrivateDocument.Encoded, typeof Envelope.Encoded>
>
export type EncodeServices = True<
  Equal<typeof PrivateDocument.EncodingServices, ReceiptKeys>
>
export type DecodeServices = True<
  Equal<typeof PrivateDocument.DecodingServices, ReceiptKeys>
>
export const twoFields = Schema.Struct({
  document: PrivateDocument,
  personal: encrypted({ schema: Document, codec: PersonalCodec })
})
export type TwoFieldServices = True<
  Equal<typeof twoFields.DecodingServices, ReceiptKeys | PersonalKeys>
>
export const enqueueTypeProbe = (
  tx: import("../../src/JobTransaction.js").JobsTransaction
) =>
  definition.enqueue(tx, {
    payload: input,
    producer: {
      operation: "poc.issue",
      operationId: "synthetic-operation",
      slot: "document"
    },
    policy: Policy.make()
  })
export type EnqueueServices = True<
  Equal<Effect.Services<ReturnType<typeof enqueueTypeProbe>>, ReceiptKeys>
>
export const handlerTypeProbe = definition.handlerLayer(
  () => Effect.void,
  Codec.decodeJobPayload
)
export type HandlerServices = True<
  Equal<Layer.Services<typeof handlerTypeProbe>, ReceiptKeys | JobRegistry>
>
export const badDomain: typeof PrivateDocument.Type = {
  recipient: "synthetic",
  // @ts-expect-error Producer and handler domain representation has numeric amount.
  amount: "1"
}
export const badWire: typeof PrivateDocument.Encoded = {
  // @ts-expect-error Persisted representation is an envelope, not a domain document.
  recipient: "synthetic",
  amount: 1
}
