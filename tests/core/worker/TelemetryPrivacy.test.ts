import assert from "node:assert/strict"
import { inspect } from "node:util"
import { Effect, Exit, Layer, Logger, Schema, Tracer } from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Worker from "../../../src/JobWorker.js"
import { drain } from "../../../src/JobWorkerRuntime.js"
import { layer as registryLayer } from "../../../src/JobRegistry.js"
import { FinalizationResults } from "../../../src/JobStore.js"
import { harness, policy } from "./Harness.js"

const queue = Queue.make("review-probe")
const job = Job.make({
  queue,
  kind: "probe",
  version: 1,
  payload: Schema.Struct({ value: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
const consumer = Effect.runSync(
  Consumer.make(queue, {
    localConcurrency: 1,
    claimLimitPerRun: 1,
    recoveryLimitPerRun: 1
  })
)

it("probe: successful claim does not expose durable secrets in span completion", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const encoded = yield* Codec.encodeJobPayload(job.payload, {
        value: "PROBE_PAYLOAD"
      })
      const test = harness([
        {
          catalog: job.catalog,
          policy,
          encoded,
          producer: { operation: "probe", operationId: "PROBE_ID", slot: "run" }
        }
      ])
      yield* Layer.build(job.handlerLayer(() => Effect.void, Codec.decodeJobPayload))
      const worker = yield* Worker.make(test.store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      })
      yield* drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
      const span = spans.find((span) => span.name === "effect-jobs.claim")!
      assert.equal(span.status._tag, "Ended")
      if (span.status._tag !== "Ended" || !Exit.isSuccess(span.status.exit)) {
        throw new Error("span not completed safely")
      }
      assert.deepEqual(span.status.exit, Exit.succeed(undefined))
      assert.equal(
        inspect(span.status.exit, { depth: null }).includes(
          test.calls.claims[0]!.leaseToken
        ),
        false,
        "span completion exposes original leaseToken on a normal successful claim"
      )
      assert.equal(
        inspect(span.status.exit, { depth: null }).includes("PROBE_ID"),
        false,
        "span completion exposes producer operationId on a normal successful claim"
      )
    }).pipe(
      Effect.provide(Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([]))),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.scoped
    )
  )
})

for (const phase of ["finalize", "reconcileFinalization"] as const) {
  it(`probe: ${phase} defect preserves unknown outcome and bounded telemetry`, async () => {
    const logs: string[] = []
    const spans: Tracer.NativeSpan[] = []
    const logger = Logger.make((options) => logs.push(Logger.formatJson.log(options)))
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(job.payload, {
          value: "PROBE_PAYLOAD"
        })
        const test = harness([
          {
            catalog: job.catalog,
            policy,
            encoded,
            producer: { operation: "probe", operationId: "PROBE_ID", slot: "run" }
          }
        ])
        let invoked = 0
        let defects = 0
        yield* Layer.build(
          job.handlerLayer(
            () =>
              Effect.sync(() => {
                invoked++
              }),
            Codec.decodeJobPayload
          )
        )
        const worker = yield* Worker.make(
          {
            ...test.store,
            ...(phase === "reconcileFinalization"
              ? { finalize: () => Effect.succeed(FinalizationResults.Unknown()) }
              : {}),
            [phase]: () =>
              Effect.sync(() => {
                defects++
              }).pipe(
                Effect.andThen(
                  Effect.die({
                    nested: {
                      defect: "PROBE_RAW_DEFECT",
                      encoded,
                      fingerprint: "PROBE_FINGERPRINT"
                    }
                  })
                )
              )
          },
          { catalog: [job], operationResponseBudgetMillis: 100 }
        )
        const result = yield* drain(consumer).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
        assert.equal(result._tag, "MoreWork")
        assert.equal(invoked, 1)
        assert.equal(defects, 1)
        assert.equal(test.rows[0]!.snapshot.state, "Active")
        assert.equal(test.rows[0]!.snapshot.attemptsMade, 0)
        assert.equal(test.calls.releases, 0)
        for (const span of spans) {
          assert.equal(span.status._tag, "Ended")
          if (span.status._tag !== "Ended") {
            throw new Error("span not ended")
          }
          assert.deepEqual(span.status.exit, Exit.succeed(undefined))
        }
        const observed = JSON.stringify(logs) + inspect(spans, { depth: null })
        for (const value of [
          "PROBE_RAW_DEFECT",
          "PROBE_PAYLOAD",
          "PROBE_ID",
          "PROBE_FINGERPRINT",
          test.calls.claims[0]!.leaseToken
        ]) {
          assert.equal(observed.includes(value), false, `telemetry leaked ${value}`)
        }
        assert.ok(logs.some((log) => log.includes('"jobs.cause_kind":"defect"')))
      }).pipe(
        Effect.provide(
          Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([logger]))
        ),
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.scoped
      )
    )
  })
}

for (const count of [-1, 1.5, 2, NaN, Infinity]) {
  it(`probe: invalid recovery count ${count} stops before any claim`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const test = harness()
        yield* Layer.build(job.handlerLayer(() => Effect.void, Codec.decodeJobPayload))
        const worker = yield* Worker.make(
          { ...test.store, recoverExpired: () => Effect.succeed(count) },
          { catalog: [job], operationResponseBudgetMillis: 100 }
        )
        const result = yield* drain(consumer).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
        assert.deepEqual(result, { _tag: "Backoff", phase: "recovery", claimed: 0 })
        assert.equal(test.calls.claims.length, 0)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([]))
        ),
        Effect.scoped
      )
    )
  })
}
