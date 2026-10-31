import * as BoundedSink from "./BoundedSink.mjs"
// Synthetic application-owned consumer. No credentials, external endpoint or production storage.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

const root = resolve(process.env.OBS_CONSUMER_ROOT ?? ".")
const require = createRequire(resolve(root, "package.json"))
const pkg = (name) => import(pathToFileURL(require.resolve(name)).href)
const library = (name) =>
  process.env.OBS_PACKED
    ? import(
        pathToFileURL(
          resolve(
            root,
            "node_modules/effect-jobs",
            JSON.parse(
              readFileSync(resolve(root, "node_modules/effect-jobs/package.json"))
            ).exports[`./${name}`].import
          )
        ).href
      )
    : import(
        pathToFileURL(
          resolve(
            root,
            process.env.OBS_SOURCE ? "src" : "dist",
            `${name}.${process.env.OBS_SOURCE ? "ts" : "js"}`
          )
        ).href
      )
const { Cause, Context, Effect, Exit, Layer, Logger, Metric, References, Schema } =
  await pkg("effect")
const { HttpClient } = await pkg("effect/http")
const { OtlpExporter, OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } =
  await pkg("effect/observability")
const { makeWithTransaction } = await pkg("effect/sql/SqlClient")
const { ConnectionError, SqlError } = await pkg("effect/sql/SqlError")
const [Job, Queue, Codec, Enqueue, Policy, Registry, Worker, Runtime, Consumer, Native] =
  await Promise.all(
    [
      "Job",
      "JobQueue",
      "JobPayloadCodec",
      "JobEnqueue",
      "JobPolicy",
      "JobRegistry",
      "JobWorker",
      "JobWorkerRuntime",
      "JobConsumer",
      "PostgreSqlNative"
    ].map(library)
  )
const base = process.env.OBS_COLLECTOR_URL
const metricBase = process.env.OBS_METRIC_URL
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
assert.match(metricBase, /^http:\/\/127\.0\.0\.1:\d+$/)
const queue = Queue.make("synthetic")
const job = Job.make({
  queue,
  kind: "synthetic",
  payload: Schema.Struct({ value: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
const policy = Policy.defaultPolicy
const consumer = Effect.runSync(
  Consumer.make(queue, {
    localConcurrency: 1,
    claimLimitPerRun: 1,
    recoveryLimitPerRun: 1
  })
)
const controlCanary = "SYNTHETIC_NATIVE_CONTROL_CANARY"
const transactionService = Context.Service("synthetic/transaction")
const withTransaction = makeWithTransaction({
  transactionService,
  spanAttributes: [],
  acquireConnection: () => Effect.succeed({}),
  begin: () => Effect.void,
  savepoint: () => Effect.void,
  rollback: () => Effect.void,
  rollbackSavepoint: () => Effect.void,
  commit: () =>
    Effect.fail(
      new SqlError({
        reason: new ConnectionError({
          message: controlCanary,
          cause: new Error(controlCanary)
        })
      })
    )
})
const native = Native.make({
  client: { transactionService, withTransaction },
  operationTimeoutMillis: 100
})
const captures = []
const accepted = []
let sinkStats
let invoked = 0
const program = Effect.gen(function* () {
  const sink = yield* BoundedSink.make({
    traces: `${base}/v1/traces`,
    logs: `${base}/v1/logs`,
    metrics: `${metricBase}/v1/metrics`
  })
  sinkStats = sink.stats
  return yield* Effect.gen(function* () {
    const options = {
      resource: {
        serviceName: "jobs-synthetic",
        serviceVersion: "test",
        attributes: { "deployment.environment.name": "test" }
      },
      exportInterval: "1 hour",
      shutdownTimeout: "500 millis"
    }
    const tracer = sink.tracer(
      yield* OtlpTracer.make({
        ...options,
        url: `${base}/v1/traces`,
        maxBatchSize: 1
      })
    )
    const logger = sink.logger(
      yield* OtlpLogger.make({
        ...options,
        url: `${base}/v1/logs`,
        maxBatchSize: 1
      })
    )
    yield* OtlpMetrics.make({ ...options, url: `${metricBase}/v1/metrics` })
    let prepared
    let claimed = false
    const store = {
      recoverExpired: () => Effect.succeed(0),
      claim: (request) =>
        Effect.sync(() => {
          if (claimed) {
            return { _tag: "Empty" }
          }
          claimed = true
          const ownership = {
            jobId: "synthetic-job",
            leaseToken: request.leaseToken,
            leaseExpiresAt: 1725000060000,
            lifecycleVersion: 1
          }
          return {
            _tag: "Claimed",
            claim: {
              ownership,
              prepared,
              snapshot: {
                ...ownership,
                state: "Active",
                policy,
                availableAt: 1725000000000,
                updatedAt: 1725000000010,
                attemptsMade: 0,
                stalledCount: 0,
                completedAt: null,
                lastFailureCode: null
              }
            }
          }
        }),
      finalize: () => Effect.succeed({ _tag: "Applied" }),
      release: () => Effect.succeed({ _tag: "Applied" }),
      reconcileClaim: () => Effect.succeed({ _tag: "Unknown" }),
      reconcileFinalization: () => Effect.succeed({ _tag: "Unknown" })
    }
    const producer = {
      enqueue: (input) =>
        Effect.tap(input, (value) =>
          Effect.sync(() => {
            prepared = value
          })
        ).pipe(Effect.as({ _tag: "Inserted", jobId: "synthetic-job" })),
      enqueueStandalone: (input) =>
        Effect.tap(input, (value) =>
          Effect.sync(() => {
            prepared = value
          })
        ).pipe(Effect.as({ _tag: "Inserted", jobId: "synthetic-job" }))
    }
    const work = Effect.gen(function* () {
      yield* job
        .enqueue({
          payload: { value: "SYNTHETIC_PAYLOAD_CANARY" },
          producer: {
            operation: "synthetic",
            operationId: "SYNTHETIC_PRODUCER_CANARY",
            slot: "run"
          },
          policy
        })
        .pipe(Effect.provideService(Enqueue.JobEnqueue, producer))
      yield* Layer.build(
        job.handlerLayer(
          () =>
            Effect.sync(() => {
              invoked++
            }),
          Codec.decodeJobPayload
        )
      )
      const worker = yield* Worker.make(store, {
        catalog: [job],
        operationResponseBudgetMillis: 100
      })
      yield* Runtime.drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
      const exit = yield* native.ownedTransaction(() => Effect.void).pipe(Effect.exit)
      assert.ok(Exit.isFailure(exit) && !Cause.pretty(exit.cause).includes(controlCanary))
      yield* (yield* OtlpExporter.Flusher).flush
      yield* sink.flush
      // #region motel debug
      // H1: native transaction failure escapes before controls; H2: annotations survive
      // serialization; H3: positive app failure remains queryable after scoped protection.
      yield* Effect.logInfo("synthetic query control").pipe(
        Effect.annotateLogs({
          "debug.session": "observability",
          "debug.hypothesis": "annotations"
        })
      )
      yield* Effect.die(new Error("SYNTHETIC_APP_POSITIVE_CONTROL")).pipe(
        Effect.withSpan("application.positive", {
          attributes: {
            "debug.session": "observability",
            "debug.hypothesis": "app-boundary"
          }
        }),
        Effect.exit
      )
      // #endregion motel debug
    }).pipe(
      Effect.withTracer(tracer),
      Effect.provide(Layer.mergeAll(Logger.layer([logger]), Registry.layer))
    )
    yield* work
    assert.equal(invoked, 1)
    yield* (yield* OtlpExporter.Flusher).flush
    yield* sink.flush.pipe(Effect.timeout(10_000))
    captures.push(...sink.captures)
    accepted.push(...sink.accepted)
  }).pipe(Effect.provideService(HttpClient.HttpClient, sink.client))
}).pipe(
  Effect.provide(Layer.mergeAll(OtlpExporter.layerFlusher, OtlpSerialization.layerJson)),
  Effect.provideService(Metric.MetricRegistry, new Map()),
  Effect.provideService(Metric.CurrentMetricAttributes, {
    "request.id": "SYNTHETIC_REQUEST_CANARY"
  }),
  Effect.provideService(References.MinimumLogLevel, "Debug"),
  Effect.scoped
)
// Upstream 202 is local admission only; accepted below records real collector replies.
await Effect.runPromise(program)
assert.ok(captures.length >= 3)
assert.ok(accepted.length >= 3 && accepted.every((entry) => entry.status === 200))
const exported = captures.map((entry) => entry.body).join("\n")
assert.ok(exported.includes("SYNTHETIC_APP_POSITIVE_CONTROL"))
for (const canary of [
  controlCanary,
  "SYNTHETIC_PAYLOAD_CANARY",
  "SYNTHETIC_PRODUCER_CANARY",
  "SYNTHETIC_LEASE",
  "SYNTHETIC_REQUEST_CANARY"
]) {
  assert.ok(!exported.includes(canary), `export leaked synthetic private value`)
}
const metrics = captures
  .filter((entry) => entry.url.endsWith("/v1/metrics"))
  .flatMap((entry) =>
    JSON.parse(entry.body).resourceMetrics.flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics)
    )
  )
assert.ok(
  metrics.some(
    (metric) =>
      metric.name === "effect_jobs_operation_duration_millis" && metric.unit === "ms"
  )
)
writeFileSync(
  process.env.OBS_RECEIPT,
  JSON.stringify(
    {
      runtime: process.version,
      bun: process.versions.bun,
      invoked,
      captures,
      accepted,
      sinkStats,
      limits: BoundedSink.limits
    },
    null,
    2
  )
)
