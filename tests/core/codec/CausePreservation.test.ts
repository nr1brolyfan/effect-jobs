import assert from "node:assert/strict"
import { Cause, Effect, Exit, Layer, Schema, SchemaGetter, SchemaIssue } from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Payload from "../../../src/JobPayload.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Registry from "../../../src/JobRegistry.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Runtime from "../../../src/JobWorkerRuntime.js"
import { JobPayloadCodecError } from "../../../src/JobContract.js"
import { harness } from "../worker/Harness.js"

const providerDetail = "PRIVATE_PROVIDER_DETAIL"
const releaseDefect = { fixture: "release-defect" }
const envelope = { fingerprint: "stable", ciphertext: "fixture" }
const Envelope = Schema.Struct({ fingerprint: Schema.String, ciphertext: Schema.String })
type ReleaseKind = "defect" | "interrupt"
const failureWithRelease = <E>(error: E, kind: ReleaseKind) =>
  Effect.acquireUseRelease(
    Effect.void,
    () => Effect.fail(error),
    () => (kind === "defect" ? Effect.die(releaseDefect) : Effect.interrupt)
  )

const assertMixed = (exit: Exit.Exit<unknown, unknown>, kind: ReleaseKind) => {
  assert(Exit.isFailure(exit))
  assert.equal(exit.cause.reasons.length, 2)
  assert(Cause.hasFails(exit.cause))
  assert.equal(Cause.hasDies(exit.cause), kind === "defect")
  assert.equal(Cause.hasInterrupts(exit.cause), kind === "interrupt")
  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      assert(!JSON.stringify(reason.error).includes(providerDetail))
    }
    if (Cause.isDieReason(reason)) {
      assert.equal(reason.defect, releaseDefect)
    }
  }
  return exit.cause
}

for (const kind of ["defect", "interrupt"] as const) {
  const encrypted = (direction: "open" | "seal") =>
    Payload.encrypted({
      schema: Schema.String,
      codec: {
        envelope: Envelope,
        open: () =>
          direction === "open"
            ? failureWithRelease(
                Object.assign(new Payload.JobEncryptionError(), { providerDetail }),
                kind
              )
            : Effect.succeed("fixture"),
        seal: () =>
          direction === "seal"
            ? failureWithRelease(
                Object.assign(new Payload.JobEncryptionError(), { providerDetail }),
                kind
              )
            : Effect.succeed(envelope)
      }
    })

  const standard = (direction: "decode" | "encode") =>
    Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transformEffect((value) =>
          direction === "decode"
            ? failureWithRelease(
                new SchemaIssue.Forbidden({ message: providerDetail }),
                kind
              )
            : Effect.succeed(value)
        ),
        encode: SchemaGetter.transformEffect((value) =>
          direction === "encode"
            ? failureWithRelease(
                new SchemaIssue.Forbidden({ message: providerDetail }),
                kind
              )
            : Effect.succeed(value)
        )
      })
    )

  it(`preserves Fail plus ${kind} through encrypted open and standard decode without finalizing`, async () => {
    const schema = encrypted("open")
    const encoded = await Effect.runPromise(Codec.encodeJobPayload(schema, "fixture"))
    assertMixed(
      await Effect.runPromiseExit(Schema.decodeUnknownEffect(schema)(envelope)),
      kind
    )
    const cause = assertMixed(
      await Effect.runPromiseExit(Codec.decodeJobPayload(schema, encoded)),
      kind
    )
    assert(Cause.isFailReason(cause.reasons[0]!))
    assert(cause.reasons[0].error instanceof JobPayloadCodecError)

    const definition = Job.make({
      queue: Queue.make("mixed-codec"),
      kind: "receipt",
      payload: schema
    })
    const store = harness([
      {
        catalog: definition.catalog,
        producer: { operation: "fixture", operationId: "one", slot: "receipt" },
        policy: Policy.defaultPolicy,
        encoded
      }
    ])
    let handlerCalls = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Layer.build(
          definition.handlerLayer(
            () =>
              Effect.sync(() => {
                handlerCalls++
              }),
            Codec.decodeJobPayload
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
        yield* Runtime.drain(consumer).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
      }).pipe(
        Effect.provide(Layer.merge(Registry.layer, TestClock.layer())),
        Effect.scoped
      )
    )
    assert.equal(handlerCalls, 0)
    assert.equal(store.calls.finalizations.length, 0)
    assert.equal(store.calls.finalizationReconciliations.length, 0)
    assert.equal(store.rows[0]!.snapshot.state, "Active")
    assert.equal(store.rows[0]!.snapshot.attemptsMade, 0)
  })

  it(`preserves Fail plus ${kind} through encrypted seal and standard encode`, async () => {
    const schema = encrypted("seal")
    assertMixed(await Effect.runPromiseExit(Schema.encodeEffect(schema)("fixture")), kind)
    assertMixed(
      await Effect.runPromiseExit(Codec.encodeJobPayload(schema, "fixture")),
      kind
    )
  })

  it(`preserves Fail plus ${kind} at the independent standard decoder boundary`, async () => {
    const schema = standard("decode")
    const encoded = await Effect.runPromise(Codec.encodeJobPayload(schema, "fixture"))
    const native = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(schema)("fixture")
    )
    assert(Exit.isFailure(native))
    assert.equal(native.cause.reasons.length, 2)
    const cause = assertMixed(
      await Effect.runPromiseExit(Codec.decodeJobPayload(schema, encoded)),
      kind
    )
    assert(Cause.isFailReason(cause.reasons[0]!))
    assert(cause.reasons[0].error instanceof JobPayloadCodecError)
  })

  it(`preserves Fail plus ${kind} at the independent standard encoder boundary`, async () => {
    const schema = standard("encode")
    const native = await Effect.runPromiseExit(Schema.encodeEffect(schema)("fixture"))
    assert(Exit.isFailure(native))
    assert.equal(native.cause.reasons.length, 2)
    const cause = assertMixed(
      await Effect.runPromiseExit(Codec.encodeJobPayload(schema, "fixture")),
      kind
    )
    assert(Cause.isFailReason(cause.reasons[0]!))
    assert(cause.reasons[0].error instanceof JobPayloadCodecError)
  })
}
