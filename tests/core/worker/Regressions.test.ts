import assert from "node:assert/strict"
import { inspect } from "node:util"
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Scheduler,
  Schema,
  Tracer
} from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Worker from "../../../src/JobWorker.js"
import { observe } from "../../../src/JobTelemetry.js"
import { drain } from "../../../src/JobWorkerRuntime.js"
import { layer as registryLayer } from "../../../src/JobRegistry.js"
import { WorkerCapability } from "../../../src/internal/worker/Capability.js"
import { harness, policy } from "./Harness.js"

const privateValue = {
  leaseToken: "TOKEN_PRIVATE",
  operationId: "OPERATION_PRIVATE",
  encoded: {
    payloadBytes: new TextEncoder().encode("PAYLOAD_PRIVATE"),
    semanticProjectionBytes: new TextEncoder().encode("PROJECTION_PRIVATE")
  },
  nested: {
    defect: { fingerprint: "FINGERPRINT_PRIVATE", ciphertext: "CIPHERTEXT_PRIVATE" }
  }
}

it("closes telemetry spans with void while preserving every original channel", async () => {
  const spans: Tracer.NativeSpan[] = []
  const logs: string[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  const composite = Cause.combine(Cause.fail(privateValue), Cause.die(privateValue))
  const operations: ReadonlyArray<
    Effect.Effect<typeof privateValue, typeof privateValue | Cause.TimeoutError>
  > = [
    Effect.succeed(privateValue),
    Effect.fail(privateValue),
    Effect.die(privateValue),
    Effect.failCause(composite),
    Effect.fail(new Cause.TimeoutError()),
    Effect.interrupt
  ]
  for (const operation of operations) {
    const expected = await Effect.runPromiseExit(operation)
    const actual = await Effect.runPromiseExit(
      operation.pipe(
        observe("execute", "handler"),
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.provide(
          Logger.layer([
            Logger.make((options) => logs.push(Logger.formatJson.log(options)))
          ])
        )
      )
    )
    assert.equal(actual._tag, expected._tag)
    if (Exit.isSuccess(actual) && Exit.isSuccess(expected)) {
      assert.equal(actual.value, expected.value)
    } else if (Exit.isFailure(actual) && Exit.isFailure(expected)) {
      // Effect adds the current span's stack annotation; reason channels and
      // original failure/defect values must remain unchanged.
      assert.deepEqual(
        actual.cause.reasons.map((reason) => reason._tag),
        expected.cause.reasons.map((reason) => reason._tag)
      )
      actual.cause.reasons.forEach((reason, index) => {
        const original = expected.cause.reasons[index]!
        if (Cause.isFailReason(reason) && Cause.isFailReason(original)) {
          assert.equal(reason.error, original.error)
        } else if (Cause.isDieReason(reason) && Cause.isDieReason(original)) {
          assert.equal(reason.defect, original.defect)
        }
      })
    }
  }
  assert.equal(spans.length, operations.length)
  for (const span of spans) {
    assert.equal(span.status._tag, "Ended")
    if (span.status._tag !== "Ended") {
      throw new Error("span not ended")
    }
    // Structural oracle: no nested value/Cause/buffer can survive a void completion.
    assert.deepEqual(span.status.exit, Exit.succeed(undefined))
  }
  const exported = inspect(spans, { depth: null }) + logs.join("\n")
  for (const sentinel of [
    "TOKEN_PRIVATE",
    "OPERATION_PRIVATE",
    "FINGERPRINT_PRIVATE",
    "CIPHERTEXT_PRIVATE"
  ]) {
    assert.equal(exported.includes(sentinel), false)
  }
})

it("keeps telemetry capture invocation-local for reused and concurrent Effects", async () => {
  let sequence = 0
  const observed = Effect.suspend(() => {
    const value = { ...privateValue, sequence: sequence++ }
    return Effect.yieldNow.pipe(Effect.andThen(Effect.succeed(value)))
  }).pipe(observe("claim", "dispatch"))
  await Effect.runPromise(
    Effect.gen(function* () {
      const values = yield* Effect.all(
        Array.from({ length: 20 }, () => observed),
        { concurrency: "unbounded" }
      )
      assert.equal(new Set(values.map((value) => value.sequence)).size, 20)
      assert.equal((yield* observed).sequence, 20)
    }).pipe(
      Effect.provide(Logger.layer([])),
      Effect.provideService(Scheduler.MaxOpsBeforeYield, 3)
    )
  )
})

const queue = Queue.make("permit-regression")
const job = Job.make({
  queue,
  kind: "neutral",
  version: 1,
  payload: Schema.String,
  encodePayload: Codec.encodeJobPayload
})
const consumer = (concurrency: number) =>
  Effect.runSync(
    Consumer.make(queue, {
      localConcurrency: concurrency,
      claimLimitPerRun: 1,
      recoveryLimitPerRun: 1
    })
  )

for (const maxOps of [3, 2048]) {
  it(`shares the first queue permit across public parallel drains at MaxOps=${maxOps}`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(job.payload, "neutral")
        const test = harness(
          Array.from({ length: 20 }, (_, index) => ({
            catalog: job.catalog,
            producer: {
              operation: "neutral",
              operationId: `fixture-${index}`,
              slot: "send"
            },
            policy,
            encoded
          }))
        )
        const gate = yield* Deferred.make<void>()
        let active = 0
        let maxActive = 0
        yield* Layer.build(
          job.handlerLayer(
            () =>
              Effect.sync(() => {
                active++
                maxActive = Math.max(active, maxActive)
              }).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.ensuring(
                  Effect.sync(() => {
                    active--
                  })
                )
              ),
            Codec.decodeJobPayload
          )
        )
        const worker = yield* Worker.make(test.store, {
          catalog: [job],
          operationResponseBudgetMillis: 100
        })
        const group = yield* Effect.all(
          Array.from({ length: 20 }, () =>
            drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
          ),
          { concurrency: "unbounded" }
        ).pipe(Effect.forkChild)
        for (let index = 0; index < 500; index++) {
          yield* Effect.yieldNow
        }
        assert.deepEqual(
          {
            activeBeforeGate: active,
            claimsBeforeGate: test.calls.claims.length,
            maxActive
          },
          {
            activeBeforeGate: 1,
            claimsBeforeGate: 1,
            maxActive: 1
          }
        )
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(group)
        assert.equal(maxActive, 1)
        assert.equal(active, 0)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([]))
        ),
        Effect.provideService(Scheduler.MaxOpsBeforeYield, maxOps),
        Effect.scoped
      )
    )
  })
}

it("rejects differing concurrency on simultaneous first access", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* Worker.make(harness().store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      })
      const capability = worker[WorkerCapability]
      const exits = yield* Effect.all(
        [1, 2].map((count) => Effect.exit(capability.permits(consumer(count)))),
        { concurrency: "unbounded" }
      )
      assert.equal(exits.filter(Exit.isSuccess).length, 1)
      const failed = exits.find(Exit.isFailure)
      assert.ok(failed !== undefined && Exit.isFailure(failed))
      assert.equal(failed.cause.reasons.length, 1)
      const reason = failed.cause.reasons[0]!
      assert.ok(Cause.isFailReason(reason))
      assert.ok(reason.error instanceof Worker.JobWorkerConfigurationError)
      assert.equal(reason.error.field, "consumer")
    }).pipe(
      Effect.provide(registryLayer),
      Effect.provideService(Scheduler.MaxOpsBeforeYield, 3)
    )
  )
})
