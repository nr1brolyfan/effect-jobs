// Real loopback transport faults and actual Effect OTLP conversion under sustained load.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as BoundedSink from "./BoundedSink.mjs"
const require = createRequire(
  resolve(process.env.OBS_CONSUMER_ROOT ?? ".", "package.json")
)
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { Effect, Layer, Logger, Metric, Schema } = await load("effect")
const { HttpBody, HttpClient, HttpClientRequest } = await load("effect/http")
const { OtlpExporter, OtlpSerialization, OtlpTracer } = await load("effect/observability")
const library = (name) =>
  import(
    pathToFileURL(
      process.env.OBS_PACKED
        ? resolve(
            process.env.OBS_CONSUMER_ROOT,
            "node_modules/effect-jobs",
            JSON.parse(
              readFileSync(
                resolve(
                  process.env.OBS_CONSUMER_ROOT,
                  "node_modules/effect-jobs/package.json"
                )
              )
            ).exports[`./${name}`].import
          )
        : resolve(
            process.cwd(),
            process.env.OBS_SOURCE ? "src" : "dist",
            `${name}.${process.env.OBS_SOURCE ? "ts" : "js"}`
          )
    ).href
  )
const [Job, JobQueue, Codec, Policy, Registry, Worker, Runtime, Consumer] =
  await Promise.all(
    [
      "Job",
      "JobQueue",
      "JobPayloadCodec",
      "JobPolicy",
      "JobRegistry",
      "JobWorker",
      "JobWorkerRuntime",
      "JobConsumer"
    ].map(library)
  )
const queue = JobQueue.make("load-proof")
const definition = Job.make({ queue, kind: "load-proof", payload: Schema.String })
const consumer = Effect.runSync(
  Consumer.make(queue, {
    localConcurrency: 1,
    claimLimitPerRun: 1,
    recoveryLimitPerRun: 1
  })
)
const runJob = () =>
  Effect.gen(function* () {
    const encoded = yield* Codec.encodeJobPayload(definition.payload, "synthetic")
    let invoked = 0
    let finalized = false
    yield* Layer.build(
      definition.handlerLayer(
        () =>
          Effect.sync(() => {
            invoked++
          }),
        Codec.decodeJobPayload
      )
    )
    const store = {
      recoverExpired: () => Effect.succeed(0),
      claim: (request) =>
        Effect.succeed({
          _tag: "Claimed",
          claim: {
            ownership: {
              jobId: "load-job",
              leaseToken: request.leaseToken,
              leaseExpiresAt: 1725000060000,
              lifecycleVersion: 1
            },
            prepared: {
              catalog: definition.catalog,
              policy: Policy.defaultPolicy,
              encoded,
              producer: {
                operation: "synthetic",
                operationId: "synthetic-load",
                slot: "run"
              }
            },
            snapshot: {
              jobId: "load-job",
              leaseToken: request.leaseToken,
              leaseExpiresAt: 1725000060000,
              lifecycleVersion: 1,
              state: "Active",
              policy: Policy.defaultPolicy,
              availableAt: 1725000000000,
              updatedAt: 1725000000010,
              attemptsMade: 0,
              stalledCount: 0,
              completedAt: null,
              lastFailureCode: null
            }
          }
        }),
      finalize: () =>
        Effect.sync(() => {
          finalized = true
          return { _tag: "Applied" }
        }),
      release: () => Effect.succeed({ _tag: "Applied" }),
      reconcileClaim: () => Effect.succeed({ _tag: "Unknown" }),
      reconcileFinalization: () => Effect.succeed({ _tag: "Unknown" })
    }
    const worker = yield* Worker.make(store, {
      catalog: [definition],
      operationResponseBudgetMillis: 100
    })
    yield* Runtime.drain(consumer).pipe(Effect.provideService(Worker.JobWorker, worker))
    assert.equal(invoked, 1)
    assert.equal(finalized, true)
    return { invoked, finalized }
  }).pipe(Effect.provide(Registry.layer))
const limits = BoundedSink.limits
const report = { runtime: process.version, bun: process.versions.bun, limits, cases: [] }
for (const fault of ["slow", "offline"]) {
  let attempts = 0
  const server = createServer(() => {
    attempts++
  })
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
  const base = `http://127.0.0.1:${server.address().port}`
  if (fault === "offline") {
    await new Promise((ok) => server.close(ok))
  }
  let stats
  let snapshot
  let sourceInvocations = 0
  let afterClose
  let jobResult
  const start = performance.now()
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* BoundedSink.make({
          traces: `${base}/v1/traces`,
          logs: `${base}/v1/logs`,
          metrics: `${base}/v1/metrics`
        })
        stats = sink.stats
        return yield* Effect.gen(function* () {
          const host = yield* OtlpTracer.make({
            url: `${base}/v1/traces`,
            resource: { serviceName: "synthetic-load", serviceVersion: "test" },
            maxBatchSize: 1,
            exportInterval: "1 hour",
            shutdownTimeout: "100 millis"
          })
          const tracer = sink.tracer(host)
          // Positive item-limit oracle: consume actual serialized local admissions,
          // including one oversize frame. No telemetry result changes business work.
          for (let i = 0; i < limits.queueItems * 2; i++) {
            yield* sink.client.execute(
              HttpClientRequest.post(`${base}/v1/metrics`).pipe(
                HttpClientRequest.setBody(
                  HttpBody.uint8Array(new TextEncoder().encode("{}"), "application/json")
                )
              )
            )
          }
          yield* sink.client.execute(
            HttpClientRequest.post(`${base}/v1/metrics`).pipe(
              HttpClientRequest.setBody(
                HttpBody.uint8Array(
                  new Uint8Array(limits.itemBytes + 1),
                  "application/json"
                )
              )
            )
          )
          yield* sink.flush
          // Source admission positive control: many unfinished owned spans cannot
          // accumulate an unbounded native exporter queue/fiber backlog.
          yield* Effect.forEach(
            Array.from({ length: 128 }),
            () =>
              Effect.sleep(2).pipe(
                Effect.withSpan("application.source-control"),
                Effect.withTracer(tracer)
              ),
            { concurrency: "unbounded", discard: true }
          )
          for (let i = 0; i < 3000; i++) {
            yield* Effect.sync(() => {
              sourceInvocations++
            }).pipe(
              Effect.withSpan("application.load", {
                attributes: {
                  "debug.session": "sustained",
                  "debug.hypothesis": "bounded-admission",
                  padding: "s".repeat(i % 2 === 0 ? 16_384 : 64)
                }
              }),
              Effect.withTracer(tracer)
            )
            if (i === 1500) {
              jobResult = yield* runJob().pipe(Effect.withTracer(tracer))
            }
            if (i % 32 === 0) {
              yield* Effect.sleep(2)
            }
          }
          yield* (yield* OtlpExporter.Flusher).flush
          snapshot = yield* Metric.snapshot
          // Return normally while exports are still backlogged. Scope shutdown has
          // its own finite drain/drop deadline and interrupts its ONE worker.
          return "business-success"
        }).pipe(Effect.provideService(HttpClient.HttpClient, sink.client))
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            OtlpSerialization.layerJson,
            OtlpExporter.layerFlusher,
            Logger.layer([])
          )
        ),
        Effect.provideService(Metric.MetricRegistry, new Map()),
        Effect.scoped
      )
    )
    afterClose = performance.now()
    assert.equal(result, "business-success")
    assert.equal(sourceInvocations, 3000)
    assert.ok(
      stats.closed &&
        stats.queuedItems === 0 &&
        stats.queuedBytes === 0 &&
        stats.inFlight === 0
    )
    assert.equal(stats.sourcePending, 0, "all native frame reservations released")
    assert.equal(stats.maxInFlight, 1)
    assert.ok(stats.maxInFlightBytes <= limits.itemBytes)
    assert.equal(stats.maxQueuedItems, limits.queueItems, "positive item-cap oracle")
    assert.ok(
      stats.maxQueuedBytes > limits.queueBytes / 2 &&
        stats.maxQueuedBytes <= limits.queueBytes,
      "positive byte-pressure oracle"
    )
    assert.equal(stats.maxSourcePending, limits.sourceRecords)
    assert.ok(
      stats.droppedSource > 0 && stats.droppedQueue > 0 && stats.droppedOversize >= 1
    )
    assert.ok(
      stats.failed >= 2,
      "multiple actual failed requests during sustained admission"
    )
    assert.ok(
      snapshot.some(
        (metric) =>
          metric.id === "synthetic_telemetry_admission_total" &&
          metric.type === "Counter" &&
          metric.state.count > 0 &&
          metric.attributes.outcome === "queue-overflow"
      )
    )
    if (fault === "slow") {
      assert.ok(attempts >= 2)
    }
    assert.ok(afterClose - start < 15000, "finite total workload and bounded shutdown")
    report.cases.push({
      fault,
      status: "PASS",
      business: result,
      jobResult,
      sourceInvocations,
      serverAttempts: attempts,
      elapsedMillis: afterClose - start,
      stats,
      admissionMetrics: snapshot.filter((metric) =>
        metric.id.startsWith("synthetic_telemetry_")
      )
    })
  } finally {
    server.closeAllConnections()
    if (fault !== "offline") {
      await new Promise((ok) => server.close(ok))
    }
  }
}
writeFileSync(process.env.OBS_RECEIPT, JSON.stringify(report, null, 2))
