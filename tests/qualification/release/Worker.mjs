import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
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
import * as Policy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Group from "effect-jobs/JobGroup"
import * as Worker from "effect-jobs/JobWorker"
import * as Storage from "effect-jobs/JobStorage"
import * as Polling from "effect-jobs/JobPolling"
import * as Lifecycle from "effect-jobs/JobLifecycle"
import * as Store from "effect-jobs/JobStore"
import { JobId } from "effect-jobs/JobId"

const sentinel = "PRIVATE_INSTALLED_PAYLOAD"
const queue = Queue.make("installed")
const definition = Effect.runSync(
  Job.make({
    name: "neutral",
    version: 1,
    payload: Schema.Struct({ value: Schema.String })
  })
)
const group = Group.make("installed", { neutral: definition })
const catalog = { queue: queue.name, name: definition.name, version: definition.version }
const limits = { maxJobs: 1, recoveryLimit: 1 }
const policy = Policy.defaultPolicy
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
            finalizedAttempts: 0,
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
        catalog,
        producer: {
          operation: "installed.produce",
          operationId: "PRIVATE_INSTALLED_OPERATION",
          slot: "run"
        },
        policy,
        encoded
      }
      /** @type {import("effect-jobs/JobStore").JobStoreService} */
      const store = {
        claim: (request) =>
          Effect.sync(() => {
            tokens.push(request.leaseToken)
            claims++
            return claims === 1
              ? Store.ClaimResult.Claimed({
                  claim: {
                    snapshot: { ...snapshot, leaseToken: request.leaseToken },
                    ownership: { ...ownership, leaseToken: request.leaseToken },
                    prepared
                  }
                })
              : Store.ClaimResult.Empty()
          }),
        finalize: () =>
          Effect.sync(() => {
            finalized = true
            return Store.FinalizationResult.Applied()
          }),
        recoverExpired: () => Effect.succeed(0),
        reconcileClaim: () => Effect.die("unexpected reconciliation"),
        release: () => Effect.die("unexpected release"),
        reconcileFinalization: () => Effect.die("unexpected finalization reconciliation")
      }
      const handlers = JobApiBuilder.group(
        JobApi.make(group.name).pipe(JobApi.addGroup(group)),
        group.name,
        (_handlers) =>
          _handlers.handle("neutral", (input) =>
            Effect.sync(() => {
              assert.equal(input.payload.value, sentinel)
              executions++
            })
          )
      )
      const worker = yield* Worker.make(
        JobApi.make(group.name).pipe(JobApi.addGroup(group)),
        { queues: [{ queue }] }
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Storage.layer({ store, operationResponseBudgetMillis: 100 }),
            handlers
          )
        )
      )
      yield* Worker.drain(queue, limits).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.equal(executions, 1)
      assert.equal(finalized, true)
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(
        Layer.build(
          Polling.layer([queue], limits).pipe(
            Layer.provide(Layer.succeed(Worker.JobWorker, worker))
          )
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
      Effect.provide(Layer.mergeAll(TestClock.layer(), Logger.layer([]))),
      Effect.provideService(Tracer.Tracer, tracer)
    )
  )
)
console.log(
  "Installed public worker execution, scoped polling shutdown and span/metric privacy PASS"
)
