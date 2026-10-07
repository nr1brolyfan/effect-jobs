import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Registry from "../../../src/JobRegistry.js"
import * as Payload from "../../../src/JobPayload.js"
import { JobPayloadCodecError } from "../../../src/JobContract.js"
import { encodeJobPayload, decodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { canonicalBytes } from "../../../src/internal/codec/CanonicalJson.js"
import {
  prepareProjection,
  project
} from "../../../src/internal/codec/ProtectedProjection.js"
import {
  Document,
  DocumentEncryption,
  DocumentKeys,
  EncryptedDocument,
  Envelope,
  InvalidKeys,
  keys,
  keysLayer,
  PersonalEncryption,
  PersonalKeys
} from "./EncryptedFixture.js"
import { JobId } from "../../../src/JobId.js"

const document = { recipient: "PRIVATE recipient", total: 123n }
const schema = Schema.Struct({ invoiceId: Schema.String, document: EncryptedDocument })
const value = { invoiceId: "public-invoice", document }
const configured = keysLayer(keys())
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const run = <A, E>(effect: Effect.Effect<A, E, DocumentKeys>) =>
  Effect.runPromise(effect.pipe(Effect.provide(configured)))

// Build internally consistent artifact bytes from hostile wire values, as a DB
// writer could. A projection is semantic equality, never authenticity proof.
const artifact = (wire: unknown) =>
  Effect.gen(function* () {
    const ast = yield* prepareProjection(schema)
    const projection = yield* project(ast, wire)
    return {
      formatVersion: 1 as const,
      payloadBytes: yield* canonicalBytes(wire, 65536, "payload-too-large"),
      semanticProjectionBytes: yield* canonicalBytes(
        projection,
        65536,
        "projection-too-large",
        -1
      )
    }
  })

describe("schema-bound local encrypted fields", () => {
  it("stores only envelopes, opens validated domain before handler, fingerprints survive nonce/rotation", async () => {
    const a = await run(encodeJobPayload(schema, value))
    const b = await run(encodeJobPayload(schema, value))
    const rotated = await Effect.runPromise(
      encodeJobPayload(schema, value).pipe(Effect.provide(keysLayer(keys("two"))))
    )
    expect(text(a.payloadBytes)).toContain("public-invoice")
    expect(text(a.payloadBytes)).not.toContain("PRIVATE")
    expect(text(a.semanticProjectionBytes)).not.toContain("PRIVATE")
    expect(a.payloadBytes).not.toEqual(b.payloadBytes)
    expect(a.semanticProjectionBytes).toEqual(b.semanticProjectionBytes)
    expect(a.semanticProjectionBytes).toEqual(rotated.semanticProjectionBytes)
    expect(
      await Effect.runPromise(
        decodeJobPayload(schema, a).pipe(Effect.provide(keysLayer(keys("two"))))
      )
    ).toEqual(value)
    const changed = await run(
      encodeJobPayload(schema, { ...value, document: { ...document, total: 124n } })
    )
    expect(changed.semanticProjectionBytes).not.toEqual(a.semanticProjectionBytes)
    let calls = 0
    const definition = Job.make({
      queue: Queue.make("billing"),
      kind: "receipt",
      payload: schema
    })
    const RegistryLayer = Registry.layer
    const HandlerLayer = definition
      .handlerLayer(
        ({ payload }) =>
          Effect.sync(() => {
            expect(payload.document.total).toBe(123n)
            calls++
          }),
        decodeJobPayload
      )
      .pipe(Layer.provide(configured), Layer.provide(RegistryLayer))
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* Registry.JobRegistry
        yield* registry.find(definition.catalog)!.execute(a, {
          jobId: Schema.decodeSync(JobId)("job"),
          catalog: definition.catalog,
          producer: { operation: "billing.issue", operationId: "id", slot: "receipt" },
          attemptNumber: 1
        })
      }).pipe(Effect.provide(Layer.merge(RegistryLayer, HandlerLayer)))
    )
    expect(calls).toBe(1)
  })

  it("rejects tamper, unknown/wrong keys, malformed ciphertext and invalid opened domain without private errors", async () => {
    const encoded = await run(encodeJobPayload(schema, value))
    const wire = JSON.parse(text(encoded.payloadBytes)) as {
      invoiceId: string
      document: typeof Envelope.Type
    }
    const invalidDomain = await run(
      DocumentEncryption.seal({ recipient: "PRIVATE", total: "not-a-bigint" })
    )
    for (const document of [
      { ...wire.document, keyId: "unknown" },
      { ...wire.document, tag: "bad" },
      { ...wire.document, ciphertext: "bad" },
      invalidDomain
    ]) {
      const candidate = await Effect.runPromise(
        artifact({ invoiceId: wire.invoiceId, document })
      )
      const error = await run(Effect.flip(decodeJobPayload(schema, candidate)))
      expect(error).toBeInstanceOf(JobPayloadCodecError)
      expect(JSON.stringify(error)).not.toContain("PRIVATE")
    }
    const wrong = await Effect.runPromiseExit(
      decodeJobPayload(schema, encoded).pipe(Effect.provide(keysLayer(keys("one", 9))))
    )
    expect(Exit.isFailure(wrong)).toBe(true)
    expect(
      await run(
        Effect.flip(
          decodeJobPayload(schema, {
            ...encoded,
            payloadBytes: new TextEncoder().encode("{}")
          })
        )
      )
    ).toBeInstanceOf(JobPayloadCodecError)
  })

  it("supports independent services, nesting, optional/array/union branches and annotation rebuilding", async () => {
    const personal = Payload.encrypted({ schema: Document, codec: PersonalEncryption })
    const item = Schema.Union([
      Schema.Struct({ tag: Schema.Literal("private"), value: EncryptedDocument }),
      Schema.Struct({ tag: Schema.Literal("public"), value: Schema.String })
    ])
    const matrix = Schema.Struct({
      nested: Schema.Struct({
        first: EncryptedDocument.annotate({ title: "Receipt" }),
        second: personal
      }),
      items: Schema.Array(item),
      optional: Schema.optionalKey(EncryptedDocument)
    })
    const input = {
      nested: { first: document, second: document },
      items: [
        { tag: "private" as const, value: document },
        { tag: "public" as const, value: "visible" }
      ]
    }
    const layers = Layer.merge(configured, Layer.succeed(PersonalKeys, keys("one", 10)))
    const encoded = await Effect.runPromise(
      encodeJobPayload(matrix, input).pipe(Effect.provide(layers))
    )
    expect(
      await Effect.runPromise(
        decodeJobPayload(matrix, encoded).pipe(Effect.provide(layers))
      )
    ).toEqual(input)
    const optional = await run(
      encodeJobPayload(
        Schema.Struct({ optional: Schema.optionalKey(EncryptedDocument) }),
        { optional: document }
      )
    )
    expect(text(optional.semanticProjectionBytes)).toContain("/optional")
    expect(() =>
      Payload.encrypted({
        schema: Schema.Struct({ nested: EncryptedDocument.annotate({ title: "copy" }) }),
        codec: {
          envelope: Envelope,
          seal: () => Effect.die("unused"),
          open: () => Effect.die("unused")
        }
      })
    ).toThrow(Payload.InvalidEncryptedSchema)
  })

  it("validates domain before seal, enforces final bytes and preserves arbitrary defects/interruption", async () => {
    let seals = 0
    const bound = Payload.encrypted({
      schema: Document,
      codec: {
        ...DocumentEncryption,
        seal: (value) => {
          seals++
          return DocumentEncryption.seal(value)
        }
      }
    })
    await run(
      Effect.flip(
        encodeJobPayload(bound, { recipient: "x", total: "invalid" as unknown as bigint })
      )
    )
    expect(seals).toBe(0)
    const error = await run(
      Effect.flip(
        encodeJobPayload(schema, {
          ...value,
          document: { recipient: "x".repeat(70000), total: 1n }
        })
      )
    )
    expect(error.reason).toBe("payload-too-large")
    for (const open of [() => Effect.die("fixture defect"), () => Effect.interrupt]) {
      const fail = Payload.encrypted({
        schema: Document,
        codec: { ...DocumentEncryption, open }
      })
      const encoded = await run(encodeJobPayload(fail, document))
      const exit = await Effect.runPromiseExit(
        decodeJobPayload(fail, encoded).pipe(Effect.provide(configured))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(false)
      }
    }
    const invalid = await Effect.runPromiseExit(
      Effect.void.pipe(
        Effect.provide(keysLayer({ ...keys(), fingerprint: new Uint8Array(1) }))
      )
    )
    expect(Exit.isFailure(invalid)).toBe(true)
    if (Exit.isFailure(invalid)) {
      expect(Cause.squash(invalid.cause)).toBeInstanceOf(InvalidKeys)
    }
  })
})

it("actual worker isolates invalid opened artifacts before the handler under existing attempt semantics", async () => {
  const [{ harness }, Worker, Consumer, Runtime, { TestClock }, Policy] =
    await Promise.all([
      import("../worker/Harness.js"),
      import("../../../src/JobWorker.js"),
      import("../../../src/JobConsumer.js"),
      import("../../../src/JobWorkerRuntime.js"),
      import("effect/testing"),
      import("../../../src/JobPolicy.js")
    ])
  const definition = Job.make({
    queue: Queue.make("encrypted-worker"),
    kind: "receipt",
    payload: schema
  })
  const good = await run(encodeJobPayload(schema, value))
  const wire = JSON.parse(text(good.payloadBytes)) as {
    invoiceId: string
    document: typeof Envelope.Type
  }
  const bad = await Effect.runPromise(
    artifact({ ...wire, document: { ...wire.document, tag: "bad" } })
  )
  let calls = 0
  const store = harness([
    {
      catalog: definition.catalog,
      producer: { operation: "billing.issue", operationId: "id", slot: "receipt" },
      policy: Policy.defaultPolicy,
      encoded: bad
    }
  ])
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Layer.build(
        definition.handlerLayer(
          () =>
            Effect.sync(() => {
              calls++
            }),
          decodeJobPayload
        )
      )
      const worker = yield* Worker.make(store.store, {
        catalog: [definition],
        operationResponseBudgetMillis: 100
      })
      const consumer = yield* Consumer.make(definition.queue, {
        localConcurrency: 1,
        claimLimitPerRun: 1,
        recoveryLimitPerRun: 1
      })
      yield* Runtime.drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
    }).pipe(
      Effect.provide(Layer.mergeAll(configured, Registry.layer, TestClock.layer())),
      Effect.scoped
    )
  )
  expect(calls).toBe(0)
  expect(store.rows[0]!.snapshot).toMatchObject({
    state: "Isolated",
    lastFailureCode: "invalid_claimed_artifact",
    attemptsMade: 1
  })
})
