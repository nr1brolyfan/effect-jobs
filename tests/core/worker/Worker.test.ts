import * as FailureCodes from "../../../src/FailureCode.js"
import assert from "node:assert/strict"
import { inspect } from "node:util"
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Schema,
  Semaphore,
  Tracer
} from "effect"
import { TestClock } from "effect/testing"
import { it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Consumer from "../../../src/JobConsumer.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Payload from "../../../src/JobPayload.js"
import * as Policy from "../../../src/JobPolicy.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { JobRegistry, layer as registryLayer } from "../../../src/JobRegistry.js"
import * as Worker from "../../../src/JobWorker.js"
import { drain } from "../../../src/JobWorkerRuntime.js"
import { drainWithOptions } from "../../../src/internal/worker/Drain.js"
import { WorkerCapability } from "../../../src/internal/worker/Capability.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"
import { EnqueueResults } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"
import {
  ClaimReconciliations,
  ClaimResults,
  FinalizationReconciliations,
  FinalizationResults
} from "../../../src/JobStore.js"
import { harness, policy } from "./Harness.js"
import type { PreparedJob, HandlerInput } from "../../../src/JobContract.js"
import type { JobFailure } from "../../../src/JobFailure.js"
import type { JobStoreService } from "../../../src/JobStore.js"

const queue = Queue.make("worker-tests")
const definition = Job.make({
  queue,
  kind: "neutral.job",
  version: 1,
  payload: Schema.Struct({ value: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
const consumer = (claimLimitPerRun = 5, localConcurrency = 1, recoveryLimitPerRun = 1) =>
  Effect.runSync(
    Consumer.make(queue, { claimLimitPerRun, localConcurrency, recoveryLimitPerRun })
  )
const seed = (count = 1, jobPolicy = policy) =>
  Effect.gen(function* () {
    const prepared: Array<PreparedJob> = []
    for (let index = 0; index < count; index++) {
      const jobId = yield* Schema.decodeEffect(JobId)(`seed-${index}`)
      yield* withJoinedTransaction(
        (job) =>
          Effect.sync(() => {
            prepared.push(job)
            return EnqueueResults.Inserted({ jobId })
          }),
        (tx) =>
          definition.enqueueInTransaction(tx, {
            payload: { value: "PAYLOAD_SENTINEL" },
            producer: {
              operation: "test.produce",
              operationId: `OPERATION_SENTINEL-${index}`,
              slot: "send"
            },
            policy: jobPolicy
          })
      )
    }
    return harness(prepared)
  })
const make = <E>(
  store: JobStoreService<E>,
  execute: (
    input: HandlerInput<{ readonly value: string }>
  ) => Effect.Effect<void, JobFailure> = () => Effect.void
) =>
  Effect.gen(function* () {
    yield* Layer.build(definition.handlerLayer(execute, Codec.decodeJobPayload))
    return yield* Worker.make(store, {
      catalog: [definition],
      operationResponseBudgetMillis: 100
    })
  })
const run = <A, E>(
  program: Effect.Effect<A, E, JobRegistry | import("effect").Scope.Scope>
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.mergeAll(registryLayer, TestClock.layer(), Logger.layer([]))),
      Effect.scoped
    )
  )

it("runs on the explicitly selected pinned Node or Bun runtime", () => {
  if (process.env.WORKER_TEST_RUNTIME === "bun") {
    assert.equal(process.versions.bun, "1.4.2")
  } else if (process.env.WORKER_TEST_RUNTIME === "node") {
    assert.equal(process.versions.bun, undefined)
    assert.equal(process.versions.node, "24.15.0")
  }
})

it("executes a neutral schema-defined job on the real codec/registry/lifecycle engine", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed(2)
      const inputs: Array<HandlerInput<{ readonly value: string }>> = []
      const worker = yield* make(test.store, (input) =>
        Effect.sync(() => {
          assert.equal(test.isLocked(), false)
          inputs.push(input)
          assert.deepEqual(Object.keys(input.context).sort(), [
            "attemptNumber",
            "catalog",
            "jobId",
            "producer"
          ])
        })
      )
      const result = yield* drain(consumer()).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.deepEqual(result, { _tag: "Idle", claimed: 2, recovered: 0 })
      assert.equal(inputs.length, 2)
      assert.equal(inputs[0]!.context.attemptNumber, 1)
      assert.equal(test.rows[0]!.snapshot.state, "Completed")
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 1)
    })
  )
})

for (const [name, failure, state] of [
  [
    "retry",
    JobFailures.Retry({
      code: FailureCodes.define({ value: "provider_rejected" }).value
    }),
    "RetryScheduled"
  ],
  [
    "dead",
    JobFailures.Dead({ code: FailureCodes.define({ value: "permanent" }).value }),
    "Dead"
  ],
  [
    "isolate",
    JobFailures.Isolate({ code: FailureCodes.define({ value: "invalid" }).value }),
    "Isolated"
  ],
  [
    "unknown",
    JobFailures.OutcomeUnknown({
      code: FailureCodes.define({ value: "response_lost" }).value
    }),
    "Active"
  ]
] as const) {
  it(`persists only explicit ${name} using the first stored policy`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        const worker = yield* make(test.store, () => Effect.fail(failure))
        yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
        const row = test.rows[0]!.snapshot
        assert.equal(row.state, state)
        assert.equal(row.attemptsMade, name === "unknown" ? 0 : 1)
        if (name === "retry") {
          assert.equal(row.availableAt - row.updatedAt, 5_000)
        }
        assert.equal(test.calls.releases, 0)
      })
    )
  })
}

for (const [name, outcome] of [
  ["defect", Effect.die("RAW_ERROR_SENTINEL")],
  ["interruption", Effect.interrupt],
  [
    "typed plus defect",
    Effect.failCause(
      Cause.combine(
        Cause.fail(
          JobFailures.Retry({ code: FailureCodes.define({ value: "safe" }).value })
        ),
        Cause.die("RAW_ERROR_SENTINEL")
      )
    )
  ],
  [
    "typed plus interruption",
    Effect.failCause(
      Cause.combine(
        Cause.fail(
          JobFailures.Retry({ code: FailureCodes.define({ value: "safe" }).value })
        ),
        Cause.interrupt()
      )
    )
  ],
  [
    "two typed failures",
    Effect.failCause(
      Cause.combine(
        Cause.fail(
          JobFailures.Retry({ code: FailureCodes.define({ value: "safe" }).value })
        ),
        Cause.fail(
          JobFailures.Dead({ code: FailureCodes.define({ value: "dead" }).value })
        )
      )
    )
  ],
  [
    "malformed typed failure",
    Effect.fail({ _tag: "Retry", code: "PRIVATE BAD CODE" } as JobFailure)
  ]
] as const) {
  it(`leaves ${name} Active without release, replay or finalization`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        const worker = yield* make(test.store, () => outcome)
        yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
        assert.equal(test.rows[0]!.snapshot.state, "Active")
        assert.equal(test.calls.finalizations.length, 0)
        assert.equal(test.calls.releases, 0)
      })
    )
  })
}

for (const corruption of [
  "payload",
  "projection",
  "metadata",
  "policy",
  "format"
] as const) {
  it(`isolates invalid persisted ${corruption} before the handler`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        const prepared = test.rows[0]!.prepared as PreparedJob
        test.rows[0]!.prepared =
          corruption === "metadata"
            ? {
                ...prepared,
                producer: {
                  operation: prepared.producer.operation,
                  slot: prepared.producer.slot,
                  operationId: ""
                }
              }
            : corruption === "policy"
              ? { ...prepared, policy: Policy.make({ maxAttempts: 4 }) }
              : {
                  ...prepared,
                  encoded: {
                    ...prepared.encoded,
                    ...(corruption === "format"
                      ? { formatVersion: 2 }
                      : corruption === "payload"
                        ? { payloadBytes: new TextEncoder().encode("{}") }
                        : { semanticProjectionBytes: new TextEncoder().encode("{}") })
                  }
                }
        let executed = 0
        const worker = yield* make(test.store, () =>
          Effect.sync(() => {
            executed++
          })
        )
        yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
        assert.equal(executed, 0)
        assert.equal(test.rows[0]!.snapshot.state, "Isolated")
        assert.equal(test.rows[0]!.snapshot.lastFailureCode, "invalid_claimed_artifact")
      })
    )
  })
}

it("does not claim unsupported durable versions or consume their counters", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const prepared = test.rows[0]!.prepared as PreparedJob
      const unsupported = {
        ...prepared,
        catalog: {
          queue: prepared.catalog.queue,
          kind: prepared.catalog.kind,
          version: 2
        }
      }
      const other = harness([unsupported])
      const worker = yield* make(other.store)
      const result = yield* drain(consumer()).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.equal(result._tag, "Idle")
      assert.equal(other.rows[0]!.snapshot.state, "Pending")
      assert.equal(other.rows[0]!.snapshot.attemptsMade, 0)
      assert.deepEqual(other.calls.claims[0]!.supportedCatalog, [definition.catalog])
    })
  )
})

it("requires all catalog handlers before recovery/claim and rejects mismatched runtime concurrency", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const worker = yield* Worker.make(test.store, {
        catalog: [definition],
        operationResponseBudgetMillis: 100
      })
      const notReady = yield* drain(consumer()).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.result
      )
      assert.equal(notReady._tag, "Failure")
      assert.equal(test.calls.claims.length, 0)
      assert.equal(test.calls.recoveries.length, 0)
      yield* Layer.build(
        definition.handlerLayer(() => Effect.void, Codec.decodeJobPayload)
      )
      yield* drain(consumer()).pipe(Effect.provideService(Worker.JobWorker, worker))
      const conflict = yield* drain(consumer(5, 2)).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.result
      )
      assert.equal(conflict._tag, "Failure")
    })
  )
})

for (const tag of ["Applied", "StillOwned", "OwnershipLost", "Unknown"] as const) {
  it(`bounds unknown finalization reconciliation ${tag} without handler replay`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        let writes = 0
        let reconciles = 0
        let handlers = 0
        const worker = yield* make(
          {
            ...test.store,
            finalize: (request) =>
              Effect.sync(() => {
                test.calls.finalizations.push(request)
                writes++
                return FinalizationResults.Unknown()
              }),
            reconcileFinalization: (request) =>
              Effect.sync(() => {
                test.calls.finalizationReconciliations.push(request)
                reconciles++
                return FinalizationReconciliations[tag]()
              })
          },
          () =>
            Effect.sync(() => {
              handlers++
            })
        )
        yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
        assert.equal(writes, tag === "StillOwned" ? 2 : 1)
        assert.equal(reconciles, 1)
        assert.equal(handlers, 1)
        assert.equal(
          test.calls.finalizations[0],
          test.calls.finalizationReconciliations[0]
        )
        if (writes === 2) {
          assert.equal(test.calls.finalizations[0], test.calls.finalizations[1])
        }
      })
    )
  })
}

it("reconciles response-lost applied writes with original ownership and exact transition", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      let handlers = 0
      const worker = yield* make(
        {
          ...test.store,
          claim: (request) =>
            test.store.claim(request).pipe(Effect.as(ClaimResults.Unknown())),
          finalize: (request) =>
            test.store.finalize(request).pipe(Effect.as(FinalizationResults.Unknown()))
        },
        () =>
          Effect.sync(() => {
            handlers++
          })
      )
      yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.equal(test.calls.claims.length, 1)
      assert.deepEqual(test.calls.claimReconciliations, [
        test.calls.claims[0]!.leaseToken
      ])
      assert.equal(test.calls.finalizations.length, 1)
      assert.equal(test.calls.finalizationReconciliations.length, 1)
      assert.equal(handlers, 1)
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 1)
    })
  )
})

for (const tag of ["Unknown", "NotOwned"] as const) {
  it(`backs off ${tag} claim reconciliation without another claim`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        const worker = yield* make({
          ...test.store,
          claim: (request) =>
            test.store.claim(request).pipe(Effect.as(ClaimResults.Unknown())),
          reconcileClaim: () => Effect.succeed(ClaimReconciliations[tag]())
        })
        const result = yield* drain(consumer()).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
        assert.deepEqual(result, { _tag: "Backoff", phase: "reconciliation", claimed: 0 })
        assert.equal(test.calls.claims.length, 1)
        assert.equal(test.calls.finalizations.length, 0)
      })
    )
  })
}

it("releases only a confirmed insufficient lease and reports backoff, not idle", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const worker = yield* make({
        ...test.store,
        claim: (request) =>
          test.store.claim(request).pipe(Effect.as(ClaimResults.Unknown())),
        reconcileClaim: (token) =>
          test.store.reconcileClaim(token).pipe(
            Effect.map((result) => {
              assert.equal(result._tag, "Owned")
              return result._tag === "Owned"
                ? ClaimReconciliations.InsufficientLease({
                    ownership: result.claim.ownership
                  })
                : result
            })
          )
      })
      const result = yield* drain(consumer()).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.equal(result._tag, "Backoff")
      assert.equal(test.calls.releases, 1)
      assert.equal(test.rows[0]!.snapshot.state, "Pending")
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 0)
    })
  )
})

for (const phase of [
  "handler",
  "finalize",
  "claim",
  "reconcile-claim",
  "reconcile-finalize",
  "release",
  "recovery"
] as const) {
  it(`bounds suspended ${phase} and returns permits`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed(1, Policy.make({ attemptTimeout: Duration.millis(250) }))
        const store = {
          ...test.store,
          ...(phase === "finalize" ? { finalize: () => Effect.never } : {}),
          ...(phase === "claim" ? { claim: () => Effect.never } : {}),
          ...(phase === "reconcile-claim" || phase === "release"
            ? {
                claim: (request: import("../../../src/JobStore.js").ClaimRequest) =>
                  test.store.claim(request).pipe(Effect.as(ClaimResults.Unknown()))
              }
            : {}),
          ...(phase === "reconcile-claim" ? { reconcileClaim: () => Effect.never } : {}),
          ...(phase === "reconcile-finalize"
            ? {
                finalize: () => Effect.succeed(FinalizationResults.Unknown()),
                reconcileFinalization: () => Effect.never
              }
            : {}),
          ...(phase === "release"
            ? {
                release: () => Effect.never,
                reconcileClaim: (token: string) =>
                  test.store.reconcileClaim(token).pipe(
                    Effect.map((result) =>
                      result._tag === "Owned"
                        ? ClaimReconciliations.InsufficientLease({
                            ownership: result.claim.ownership
                          })
                        : result
                    )
                  )
              }
            : {}),
          ...(phase === "recovery" ? { recoverExpired: () => Effect.never } : {})
        }
        const worker = yield* make(store, () =>
          phase === "handler" ? Effect.never : Effect.void
        )
        const fiber = yield* drain(consumer(1)).pipe(
          Effect.provideService(Worker.JobWorker, worker),
          Effect.forkChild
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust(1_000)
        yield* Fiber.join(fiber)
        const permits = yield* worker[WorkerCapability].permits(consumer(1))
        assert.equal(yield* importPermit(permits), true)
        assert.equal(test.calls.finalizations.length, 0)
      })
    )
  })
}

const importPermit = (semaphore: Semaphore.Semaphore) =>
  Semaphore.take(semaphore, 1).pipe(
    Effect.as(true),
    Effect.ensuring(Semaphore.release(semaphore, 1))
  )

it("waits all executions and shares permits across parallel drains of the same runtime", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed(6)
      const gate = yield* Deferred.make<void>()
      let active = 0
      let maxActive = 0
      let finished = 0
      const worker = yield* make(test.store, () =>
        Effect.sync(() => {
          active++
          maxActive = Math.max(active, maxActive)
        }).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.ensuring(
            Effect.sync(() => {
              active--
              finished++
            })
          )
        )
      )
      const first = yield* drain(consumer(3, 2)).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.forkChild
      )
      const second = yield* drain(consumer(3, 2)).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.forkChild
      )
      for (let index = 0; index < 10; index++) {
        yield* Effect.yieldNow
      }
      assert.equal(test.calls.claims.length, 2)
      assert.equal(active, 2)
      assert.equal(finished, 0)
      yield* Deferred.succeed(gate, undefined)
      assert.equal((yield* Fiber.join(first))._tag, "MoreWork")
      assert.equal((yield* Fiber.join(second))._tag, "MoreWork")
      assert.equal(finished, 6)
      assert.equal(active, 0)
      assert.equal(maxActive, 2)
    })
  )
})

for (const boundary of ["before", "after", "claim", "permit"] as const) {
  it(`shutdown ${boundary} execution releases only pre-execution ownership and no permits leak`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed(3)
        const reached = yield* Deferred.make<void>()
        const held = yield* Deferred.make<void>()
        let entered = 0
        const worker = yield* make(
          {
            ...test.store,
            ...(boundary === "claim"
              ? {
                  claim: () =>
                    Deferred.succeed(reached, undefined).pipe(
                      Effect.andThen(Effect.never)
                    )
                }
              : {})
          },
          () =>
            Effect.sync(() => {
              entered++
            }).pipe(
              Effect.andThen(Deferred.succeed(reached, undefined)),
              Effect.andThen(Deferred.await(held))
            )
        )
        const permits = yield* worker[WorkerCapability].permits(consumer(1))
        if (boundary === "permit") {
          yield* Semaphore.take(permits, 1)
        }
        const fiber = yield* drainWithOptions(
          consumer(1),
          boundary === "before"
            ? {
                beforeExecutionBoundary: Deferred.succeed(reached, undefined).pipe(
                  Effect.andThen(Effect.never)
                )
              }
            : {}
        ).pipe(Effect.provideService(Worker.JobWorker, worker), Effect.forkChild)
        if (boundary === "permit") {
          yield* Effect.yieldNow
        } else {
          yield* Deferred.await(reached)
        }
        yield* Fiber.interrupt(fiber)
        if (boundary === "permit") {
          yield* Semaphore.release(permits, 1)
        }
        assert.equal(yield* importPermit(permits), true)
        assert.equal(test.calls.releases, boundary === "before" ? 1 : 0)
        assert.equal(test.calls.finalizations.length, 0)
        assert.equal(entered, boundary === "after" ? 1 : 0)
        if (boundary === "before") {
          assert.equal(test.rows[0]!.snapshot.state, "Pending")
        }
        if (boundary === "after") {
          assert.equal(test.rows[0]!.snapshot.state, "Active")
        }
      })
    )
  })
}

it("splits store-wide recovery into batches <=500 within the total budget", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      const limits: Array<number> = []
      const worker = yield* make({
        ...test.store,
        recoverExpired: (limit) =>
          Effect.sync(() => {
            limits.push(limit)
            return limit
          })
      })
      const result = yield* drain(consumer(1, 1, 1_201)).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.deepEqual(limits, [500, 500, 201])
      assert.deepEqual(result, { _tag: "Idle", claimed: 0, recovered: 1_201 })
    })
  )
})

it("runs notification and protected OTP-style adapters on the SAME generic engine", async () => {
  await run(
    Effect.gen(function* () {
      const notification = Job.make({
        queue,
        kind: "security.notification",
        version: 1,
        payload: Schema.Struct({
          userId: Schema.String,
          event: Schema.Literals(["registered", "password-changed"])
        }),
        encodePayload: Codec.encodeJobPayload
      })
      const otp = Job.make({
        queue,
        kind: "email.otp",
        version: 1,
        payload: Schema.Struct({
          challengeId: Schema.String,
          destination: Schema.String,
          code: Payload.protected(
            Schema.Struct({ envelope: Schema.String, fingerprint: Schema.String })
          )
        }),
        encodePayload: Codec.encodeJobPayload
      })
      const jobs: Array<PreparedJob> = []
      const jobId = yield* Schema.decodeEffect(JobId)("pattern")
      const txBody = withJoinedTransaction(
        (job) =>
          Effect.sync(() => {
            jobs.push(job)
            return EnqueueResults.Inserted({ jobId })
          }),
        (tx) =>
          Effect.gen(function* () {
            yield* notification.enqueueInTransaction(tx, {
              policy,
              producer: { operation: "auth.register", operationId: "a", slot: "notify" },
              payload: { userId: "subject", event: "registered" }
            })
            yield* otp.enqueueInTransaction(tx, {
              policy,
              producer: { operation: "auth.issue", operationId: "b", slot: "deliver" },
              payload: {
                challengeId: "challenge",
                destination: "protected-recipient",
                code: { envelope: "ciphertext", fingerprint: "keyed-fingerprint" }
              }
            })
          })
      )
      yield* txBody
      const test = harness(jobs)
      const events: Array<string> = []
      yield* Layer.build(
        notification.handlerLayer(
          ({ payload }) =>
            Effect.sync(() => {
              assert.equal(test.isLocked(), false)
              events.push(payload.event)
            }),
          Codec.decodeJobPayload
        )
      )
      yield* Layer.build(
        otp.handlerLayer(
          ({ payload }) =>
            Effect.sync(() => {
              assert.equal(test.isLocked(), false)
              // Application-owned authority/protection belongs in this adapter, not worker.
              assert.equal(payload.challengeId, "challenge")
              assert.equal(payload.code.envelope, "ciphertext")
              events.push("delivered")
            }),
          Codec.decodeJobPayload
        )
      )
      const worker = yield* Worker.make(test.store, {
        catalog: [notification, otp],
        operationResponseBudgetMillis: 100
      })
      yield* drain(consumer()).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.deepEqual(events, ["registered", "delivered"])
      assert.ok(test.rows.every((row) => row.snapshot.state === "Completed"))
    })
  )
})

it("emits bounded logs, metrics attributes and spans without raw errors or durable secrets", async () => {
  const logs: Array<string> = []
  const spans: Array<Tracer.NativeSpan> = []
  const logger = Logger.make((options) => {
    logs.push(Logger.formatJson.log(options))
  })
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const worker = yield* make(test.store, () => Effect.die("RAW_ERROR_SENTINEL"))
      yield* drain(consumer(1)).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(Tracer.Tracer, tracer)
      )
      const serialized = logs.join("\n") + inspect(spans)
      for (const secret of [
        "PAYLOAD_SENTINEL",
        "OPERATION_SENTINEL",
        "RAW_ERROR_SENTINEL",
        test.calls.claims[0]!.leaseToken,
        test.rows[0]!.snapshot.jobId
      ]) {
        assert.equal(serialized.includes(secret), false)
      }
      assert.ok(logs.some((log) => log.includes('"jobs.cause_kind":"defect"')))
      assert.ok(spans.every((span) => span.status._tag === "Ended"))
      const allowed = new Set([
        "jobs.operation",
        "jobs.phase",
        "jobs.outcome",
        "jobs.cause_kind",
        "jobs.reason_count_bucket"
      ])
      assert.ok(
        spans
          .flatMap((span) => [...span.attributes.keys()])
          .every((key) => allowed.has(key))
      )
    })
  )
})

it("allocates a fresh original claim token on each execution of a reused Effect", async () => {
  await run(
    Effect.gen(function* () {
      const test = harness()
      const worker = yield* make(test.store)
      const claim = worker[WorkerCapability].claim(queue.name)
      yield* claim
      yield* claim
      assert.equal(test.calls.claims.length, 2)
      assert.notEqual(test.calls.claims[0]!.leaseToken, test.calls.claims[1]!.leaseToken)
    })
  )
})

for (const phase of ["claim", "recovery", "finalize"] as const) {
  it(`never replays a typed ${phase} provider failure as an unconfirmed write`, async () => {
    await run(
      Effect.gen(function* () {
        const test = yield* seed()
        let failures = 0
        const failed = Effect.sync(() => {
          failures++
        }).pipe(Effect.andThen(Effect.fail("RAW_PROVIDER_SENTINEL")))
        const worker = yield* make<unknown>({
          ...test.store,
          ...(phase === "claim" ? { claim: () => failed } : {}),
          ...(phase === "recovery" ? { recoverExpired: () => failed } : {}),
          ...(phase === "finalize" ? { finalize: () => failed } : {})
        })
        const result = yield* drain(consumer(1)).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
        assert.equal(failures, 1)
        assert.equal(test.calls.claimReconciliations.length, 0)
        assert.equal(test.calls.finalizationReconciliations.length, 0)
        assert.equal(result._tag, phase === "finalize" ? "MoreWork" : "Backoff")
      })
    )
  })
}

for (const phase of ["claim", "recovery"] as const) {
  it(`reports infrastructure ${phase} defects as Backoff without raw error leakage`, async () => {
    await run(
      Effect.gen(function* () {
        const test = harness()
        const worker = yield* make({
          ...test.store,
          ...(phase === "claim"
            ? { claim: () => Effect.die("RAW_DEFECT_SENTINEL") }
            : { recoverExpired: () => Effect.die("RAW_DEFECT_SENTINEL") })
        })
        const result = yield* drain(consumer()).pipe(
          Effect.provideService(Worker.JobWorker, worker)
        )
        assert.deepEqual(result, { _tag: "Backoff", phase, claimed: 0 })
      })
    )
  })
}

it("keeps one attempt deadline across handler, write and reconciliation", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed(1, Policy.make({ attemptTimeout: Duration.millis(250) }))
      let writes = 0
      let reconciles = 0
      const worker = yield* make(
        {
          ...test.store,
          finalize: () =>
            Effect.sync(() => {
              writes++
            }).pipe(Effect.andThen(Effect.never)),
          reconcileFinalization: () =>
            Effect.sync(() => {
              reconciles++
            }).pipe(Effect.andThen(Effect.never))
        },
        () => Effect.sleep(200)
      )
      const fiber = yield* drain(consumer(1)).pipe(
        Effect.provideService(Worker.JobWorker, worker),
        Effect.forkChild
      )
      yield* Effect.yieldNow
      yield* TestClock.adjust(249)
      assert.equal(writes, 1)
      assert.equal(reconciles, 0)
      yield* TestClock.adjust(1)
      yield* Fiber.join(fiber)
      assert.equal(test.rows[0]!.snapshot.state, "Active")
      yield* TestClock.adjust(500)
      assert.equal(writes, 1)
      assert.equal(reconciles, 0)
    })
  )
})

it("leaves malformed durable ownership/snapshot Active without handler or guessed budget writes", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      let executed = 0
      const worker = yield* make(
        {
          ...test.store,
          claim: (request) =>
            test.store.claim(request).pipe(
              Effect.map((result) =>
                result._tag === "Claimed"
                  ? ClaimResults.Claimed({
                      claim: {
                        ...result.claim,
                        snapshot: {
                          ...result.claim.snapshot,
                          policy: { ...policy, attemptTimeoutMillis: 0 }
                        }
                      }
                    })
                  : result
              )
            )
        },
        () =>
          Effect.sync(() => {
            executed++
          })
      )
      yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.equal(executed, 0)
      assert.equal(test.calls.finalizations.length, 0)
      assert.equal(test.calls.releases, 0)
    })
  )
})

it("never adopts a reconciliation belonging to a different token", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const worker = yield* make({
        ...test.store,
        claim: (request) =>
          test.store.claim(request).pipe(Effect.as(ClaimResults.Unknown())),
        reconcileClaim: (token) =>
          test.store.reconcileClaim(token).pipe(
            Effect.map((result) =>
              result._tag === "Owned"
                ? ClaimReconciliations.Owned({
                    claim: {
                      ...result.claim,
                      ownership: { ...result.claim.ownership, leaseToken: "deadbeef" }
                    }
                  })
                : result
            )
          )
      })
      const result = yield* drain(consumer()).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      assert.equal(result._tag, "Backoff")
      assert.equal(test.calls.releases, 0)
      assert.equal(test.calls.finalizations.length, 0)
    })
  )
})

it("does not finalize a store-returned unsupported artifact even if that handler is installed", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const prepared = test.rows[0]!.prepared as PreparedJob
      test.rows[0]!.prepared = {
        ...prepared,
        catalog: { queue: queue.name, kind: definition.kind, version: 2 }
      }
      const registry = yield* JobRegistry
      yield* registry.install({
        catalog: { queue: queue.name, kind: definition.kind, version: 2 },
        execute: () => Effect.die("must not dispatch")
      })
      const worker = yield* make(test.store)
      yield* drain(consumer(1)).pipe(Effect.provideService(Worker.JobWorker, worker))
      assert.equal(test.rows[0]!.snapshot.state, "Active")
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 0)
      assert.equal(test.calls.finalizations.length, 0)
    })
  )
})

it("guarded internal dispatch cannot execute or release ownership twice", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed(2)
      let handlers = 0
      const worker = yield* make(test.store, () =>
        Effect.sync(() => {
          handlers++
        })
      )
      const first = yield* worker[WorkerCapability].claim(queue.name)
      assert.equal(first._tag, "Started")
      if (first._tag === "Started") {
        yield* first.release
        yield* first.release
        yield* first.execution
      }
      assert.equal(test.calls.releases, 1)
      assert.equal(handlers, 0)
      const second = yield* worker[WorkerCapability].claim(queue.name)
      if (second._tag === "Started") {
        yield* second.execution
        yield* second.execution
        yield* second.release
      }
      assert.equal(test.calls.releases, 1)
      assert.equal(test.calls.finalizations.length, 1)
      assert.equal(handlers, 1)
    })
  )
})

it("recovery repeats attemptNumber but consumes only the independent stalled budget", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const attempts: Array<number> = []
      const worker = yield* make(test.store, ({ context }) =>
        Effect.sync(() => {
          attempts.push(context.attemptNumber)
        }).pipe(
          Effect.andThen(
            Effect.fail(
              JobFailures.OutcomeUnknown({
                code: FailureCodes.define({ value: "response_lost" }).value
              })
            )
          )
        )
      )
      const once = drain(consumer(1)).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      yield* once
      yield* TestClock.adjust(90_000)
      yield* once
      assert.deepEqual(attempts, [1, 1])
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 0)
      assert.equal(test.rows[0]!.snapshot.stalledCount, 1)
      yield* TestClock.adjust(90_000)
      yield* once
      assert.deepEqual(attempts, [1, 1])
      assert.equal(test.rows[0]!.snapshot.state, "Dead")
      assert.equal(test.rows[0]!.snapshot.stalledCount, 2)
    })
  )
})

it("limits finalized retries to three attempts using the fixed persisted delay", async () => {
  await run(
    Effect.gen(function* () {
      const test = yield* seed()
      const attempts: Array<number> = []
      const worker = yield* make(test.store, ({ context }) =>
        Effect.sync(() => {
          attempts.push(context.attemptNumber)
        }).pipe(
          Effect.andThen(
            Effect.fail(
              JobFailures.Retry({
                code: FailureCodes.define({ value: "rejected" }).value
              })
            )
          )
        )
      )
      const once = drain(consumer(1)).pipe(
        Effect.provideService(Worker.JobWorker, worker)
      )
      yield* once
      for (let index = 0; index < 2; index++) {
        yield* TestClock.adjust(4_999)
        assert.equal((yield* once)._tag, "Idle")
        yield* TestClock.adjust(1)
        yield* once
      }
      assert.deepEqual(attempts, [1, 2, 3])
      assert.equal(test.rows[0]!.snapshot.state, "Dead")
      assert.equal(test.rows[0]!.snapshot.attemptsMade, 3)
      assert.equal(test.rows[0]!.snapshot.stalledCount, 0)
    })
  )
})
