// Actual OTLP exporter with local synthetic transport faults; no external calls.
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { Effect, Layer, Logger, Metric, References } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability"
import { it } from "vitest"
import { observe } from "../../../src/JobTelemetry.js"

for (const mode of ["rejected", "slow", "offline"] as const) {
  it(`collector ${mode} does not change job result; finite flush/shutdown`, async () => {
    let attempts = 0
    const server = createServer((_request, response) => {
      if (mode === "rejected") {
        response.writeHead(400).end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address !== null && typeof address !== "string")
    const url = `http://127.0.0.1:${address.port}/v1/traces`
    if (mode === "offline") {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const transport = Layer.effect(
      HttpClient.HttpClient,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        return client.pipe(
          HttpClient.mapRequest((request) => {
            attempts++
            return request
          })
        )
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))
    const started = performance.now()
    try {
      const value = await Effect.runPromise(
        Effect.gen(function* () {
          const tracer = yield* OtlpTracer.make({
            url,
            resource: { serviceName: "synthetic", serviceVersion: "test" },
            exportInterval: "1 hour",
            maxBatchSize: 128,
            shutdownTimeout: "30 millis"
          })
          const result = yield* Effect.succeed(42).pipe(
            observe("execute", "handler"),
            Effect.withTracer(tracer)
          )
          yield* (yield* OtlpExporter.Flusher).flush.pipe(
            Effect.timeoutOption("30 millis")
          )
          return result
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              OtlpSerialization.layerJson,
              OtlpExporter.layerFlusher,
              Logger.layer([]),
              transport
            )
          ),
          Effect.scoped
        )
      )
      assert.equal(value, 42)
      assert.ok(attempts > 0, "transport fault oracle exercised")
      assert.ok(performance.now() - started < 1500, "bounded finite workload/shutdown")
    } finally {
      server.closeAllConnections()
      if (mode !== "offline") {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  })
}

it("metrics survive disabled tracing/logs; synchronous sink defects remain defects", async () => {
  const samples = await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.void.pipe(
        observe("execute", "handler"),
        Effect.withTracerEnabled(false)
      )
      return yield* Metric.snapshot
    }).pipe(
      Effect.provideService(Metric.MetricRegistry, new Map()),
      Effect.provideService(References.MinimumLogLevel, "None")
    )
  )
  assert.ok(
    samples.some(
      (metric) =>
        metric.id === "effect_jobs_operation_total" &&
        metric.type === "Counter" &&
        metric.state.count === 1
    )
  )
  const logger = Logger.make(() => {
    throw new Error("SYNTHETIC_SYNC_SINK_DEFECT")
  })
  const exit = await Effect.runPromiseExit(
    Effect.void.pipe(
      observe("execute", "handler"),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "Debug")
    )
  )
  assert.equal(exit._tag, "Failure")
})
