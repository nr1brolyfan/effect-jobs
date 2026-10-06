import assert from "node:assert/strict"
import { inspect } from "node:util"
import {
  Effect,
  Exit,
  Layer,
  Logger,
  Metric,
  Result,
  Schema,
  Scope,
  Tracer
} from "effect"
import { TestClock } from "effect/testing"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import { drain } from "effect-jobs/JobWorkerRuntime"
import { layerForPlan } from "effect-jobs/PollingJobWorker"
import * as Lifecycle from "effect-jobs/JobLifecycle"
import * as Store from "effect-jobs/JobStore"
import { JobId } from "effect-jobs/JobId"

const sentinel = "PRIVATE_INSTALLED_PAYLOAD"
const queue = Queue.make("installed")
const definition = Job.make({
  queue,
  kind: "neutral",
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
const plan = Effect.runSync(Consumer.plan(consumer))
const policy = Policy.make()
const spans = []
const tracer = Tracer.make({
  span(options) {
    const span = new Tracer.NativeSpan(options)
    spans.push(span)
    return span
  }
})
const tokens = []
let claims = 0
let finalized = false
let executions = 0
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* Codec.encodeJobPayload(definition.payload, {
        value: sentinel
      })
      const snapshot = Result.getOrThrow(
        Lifecycle.claim(
          {
            jobId: Schema.decodeSync(JobId)("PRIVATE_INSTALLED_JOB"),
            policy,
            state: "Pending",
            availableAt: 100000,
            updatedAt: 100000,
            attemptsMade: 0,
            stalledCount: 0,
            lifecycleVersion: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: null,
            lastFailureCode: null
          },
          "abcd-1234-feed-5678",
          100000,
          100
        )
      )
      const ownership = Result.getOrThrow(Lifecycle.ownershipOf(snapshot))
      const prepared = {
        catalog: definition.catalog,
        producer: Producer.make({
          operation: "installed.produce",
          slots: ["run"]
        }).identity({ operationId: "PRIVATE_INSTALLED_OPERATION", slot: "run" }),
        policy,
        encoded
      }
      const store = {
        claim: (request) =>
          Effect.sync(() => {
            tokens.push(request.leaseToken)
            claims++
            return claims === 1
              ? Store.ClaimResults.Claimed({
                  claim: {
                    snapshot: { ...snapshot, leaseToken: request.leaseToken },
                    ownership: { ...ownership, leaseToken: request.leaseToken },
                    prepared
                  }
                })
              : Store.ClaimResults.Empty()
          }),
        finalize: () =>
          Effect.sync(() => {
            finalized = true
            return Store.FinalizationResults.Applied()
          }),
        recoverExpired: () => Effect.succeed(0),
        reconcileClaim: () => Effect.die("unexpected reconciliation"),
        release: () => Effect.die("unexpected release"),
        reconcileFinalization: () => Effect.die("unexpected finalization reconciliation")
      }
      yield* Layer.build(
        definition.handlerLayer(
          ({ payload }) =>
            Effect.sync(() => {
              assert.equal(payload.value, sentinel)
              executions++
            }),
          Codec.decodeJobPayload
        )
      )
      const worker = yield* Worker.make(store, {
        catalog: [definition],
        operationResponseBudgetMillis: 100
      })
      yield* drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.equal(executions, 1)
      assert.equal(finalized, true)
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(
        Layer.build(
          layerForPlan(plan).pipe(Layer.provide(Layer.succeed(Worker.JobWorker, worker)))
        )
      )
      yield* Effect.yieldNow
      assert(claims > 1)
      yield* Scope.close(scope, Exit.void)
      const stopped = claims
      yield* TestClock.adjust(60000)
      assert.equal(claims, stopped)
      const metrics = yield* Metric.snapshot
      const visible = inspect(
        {
          spans: spans.map((span) => ({
            name: span.name,
            attributes: span.attributes,
            status: span.status
          })),
          metrics
        },
        { depth: null }
      )
      for (const secret of [
        sentinel,
        "PRIVATE_INSTALLED_JOB",
        "PRIVATE_INSTALLED_OPERATION",
        "abcd-1234-feed-5678",
        ...tokens
      ]) {
        assert.equal(visible.includes(secret), false)
      }
      const claimSpan = spans.find((span) => span.name === "effect-jobs.claim")
      assert.deepEqual(claimSpan.status.exit, Exit.succeed(undefined))
    }).pipe(
      Effect.provide(Layer.mergeAll(Registry.layer, TestClock.layer(), Logger.layer([]))),
      Effect.provideService(Tracer.Tracer, tracer)
    )
  )
)
console.log(
  "Installed public worker execution, scoped polling shutdown and span/metric privacy PASS"
)
