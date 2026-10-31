import assert from "node:assert/strict"
import { Duration, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as Retry from "../../../src/JobRetryPolicy.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Codes from "../../../src/FailureCode.js"
import * as Registry from "../../../src/JobRegistry.js"
import * as Worker from "../../../src/JobWorker.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Runtime from "../../../src/JobWorkerRuntime.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { FinalizationResults } from "../../../src/JobStore.js"
import type { FinalizationRequest } from "../../../src/JobStore.js"
import { harness } from "./Harness.js"

const queue = Queue.make("jitter-test")
const definition = Job.make({ queue, kind: "send", payload: Schema.String })
const code = Codes.define({ busy: "busy" }).busy

it.each([
  { loss: "before-commit", jitter: "ProportionalV1" },
  { loss: "after-commit", jitter: "ProportionalV1" },
  { loss: "before-commit", jitter: "Full" },
  { loss: "after-commit", jitter: "Full" }
] as const)("samples $jitter once after response loss $loss", async (scenario) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const built = yield* Policy.make({
        retry: Retry.exponential(Duration.seconds(1)).pipe(
          Retry.jittered(),
          Retry.maxAttempts(5)
        )
      })
      // Full is a previously stored format, not a new builder option.
      const policy = yield* Schema.decodeUnknownEffect(Policy.PersistedJobPolicy)({
        ...built,
        retrySchedule: { ...built.retrySchedule, jitter: scenario.jitter }
      })
      const test = harness([
        {
          catalog: definition.catalog,
          producer: { operation: "test", operationId: "one", slot: "send" },
          policy,
          encoded: yield* Codec.encodeJobPayload(Schema.String, "fixture")
        }
      ])
      const requests: Array<FinalizationRequest> = []
      const store = {
        ...test.store,
        finalize: (request: FinalizationRequest) => {
          requests.push(request)
          if (requests.length !== 1) {
            return test.store.finalize(request)
          }
          return scenario.loss === "before-commit"
            ? Effect.succeed(FinalizationResults.Unknown())
            : test.store.finalize(request).pipe(Effect.as(FinalizationResults.Unknown()))
        }
      }
      let handlerCalls = 0
      yield* Layer.build(
        definition.handlerLayer(
          () =>
            Effect.sync(() => {
              handlerCalls++
            }).pipe(Effect.andThen(Effect.fail(JobFailures.Retry({ code })))),
          Codec.decodeJobPayload
        )
      )
      const worker = yield* Worker.make(store, {
        catalog: [definition],
        operationResponseBudgetMillis: 100
      })
      const consumer = yield* Consumer.make(queue, {
        localConcurrency: 1,
        claimLimitPerRun: 1,
        recoveryLimitPerRun: 1
      })
      yield* Runtime.drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.equal(handlerCalls, 1)
      assert.equal(requests.length, scenario.loss === "before-commit" ? 2 : 1)
      if (requests.length === 2) {
        assert.equal(requests[0], requests[1])
      }
      assert.equal(requests[0], test.calls.finalizationReconciliations[0])
      const command = requests[0]!.finalization
      assert(command._tag === "Retry")
      assert(
        command.jitterSample !== undefined &&
          command.jitterSample >= 0 &&
          command.jitterSample < 1
      )
      const row = test.rows[0]!.snapshot
      assert.equal(row.state, "RetryScheduled")
      assert.equal(
        row.availableAt - row.updatedAt,
        scenario.jitter === "Full"
          ? Math.floor(command.jitterSample * 1001)
          : 800 + Math.floor(command.jitterSample * 401)
      )
      assert.equal(row.attemptsMade, 1)
    }).pipe(Effect.provide(Layer.merge(Registry.layer, TestClock.layer())), Effect.scoped)
  )
})
