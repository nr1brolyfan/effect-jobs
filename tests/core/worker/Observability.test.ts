import assert from "node:assert/strict"
import { Cause, Effect, Exit, Fiber, Logger, Metric, References, Tracer } from "effect"
import { it } from "vitest"
import { define } from "../../../src/FailureCode.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { classify, observe, trackExecution } from "../../../src/JobTelemetry.js"

const code = define({ probe: "synthetic_probe" }).probe
for (const tag of ["Retry", "Dead", "Isolate", "OutcomeUnknown"] as const) {
  it(`classifies only single expected ${tag}; mixed Causes retain all reasons`, async () => {
    const failure = JobFailures[tag]({ code })
    const effect = Effect.fail(failure).pipe(observe("execute", "handler"))
    const exit = await Effect.runPromiseExit(
      effect.pipe(Effect.provide(Logger.layer([])))
    )
    assert.equal(classify(exit), tag === "OutcomeUnknown" ? "unknown" : tag.toLowerCase())
    assert.ok(Exit.isFailure(exit))
    assert.equal(exit.cause.reasons.length, 1)
    const reason = exit.cause.reasons[0]!
    assert.ok(Cause.isFailReason(reason))
    assert.equal(reason.error, failure)
    const mixed = Exit.failCause(
      Cause.combine(Cause.fail(failure), Cause.die("SYNTHETIC"))
    )
    assert.equal(classify(mixed), "failure")
  })
}

it("isolates labels and registry, uses annotations, balances in-flight on real interruption and reuse", async () => {
  const logs: Array<ReturnType<typeof Logger.formatStructured.log>> = []
  const spans: Tracer.NativeSpan[] = []
  const logger = Logger.make((event) => logs.push(Logger.formatStructured.log(event)))
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  const registry = new Map()
  await Effect.runPromise(
    Effect.gen(function* () {
      const reused = Effect.void.pipe(observe("execute", "handler"), trackExecution)
      yield* Effect.all([reused, reused], { concurrency: 2 })
      const started = yield* Effect.forkChild(Effect.never.pipe(trackExecution))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(started)
      const samples = yield* Metric.snapshot
      assert.ok(samples.length >= 3)
      for (const sample of samples) {
        assert.equal(sample.attributes?.["request.id"], undefined)
      }
      const inflight = samples.find(
        (sample) => sample.id === "effect_jobs_execution_in_flight"
      )!
      assert.equal(inflight.type === "Counter" && inflight.state.count, 0)
      const total = samples.filter(
        (sample) => sample.id === "effect_jobs_operation_total"
      )
      assert.equal(
        total.reduce(
          (n, metric) => n + (metric.type === "Counter" ? Number(metric.state.count) : 0),
          0
        ),
        2
      )
      assert.ok(
        samples.some(
          (sample) =>
            sample.id === "effect_jobs_operation_duration_millis" &&
            sample.attributes?.unit === "ms"
        )
      )
    }).pipe(
      Effect.provideService(Metric.MetricRegistry, registry),
      Effect.provideService(Metric.CurrentMetricAttributes, {
        "request.id": "SYNTHETIC_REQUEST"
      }),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.provide(Logger.layer([logger]))
    )
  )
  assert.equal(logs.length, 2)
  assert.equal(logs[0]!.annotations["jobs.operation"], "execute")
  assert.equal(logs[0]!.message, "effect-jobs operation completed")
  assert.ok(
    spans.length === 2 &&
      spans.every(
        (span) =>
          span.status._tag === "Ended" &&
          Exit.isSuccess(span.status.exit) &&
          span.status.exit.value === undefined
      )
  )
  assert.equal(JSON.stringify(logs).includes("SYNTHETIC_REQUEST"), false)
})

it("reports owning deadline as timeout while the handler accurately reports interruption", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  const exit = await Effect.runPromiseExit(
    Effect.never.pipe(
      observe("execute", "handler"),
      Effect.timeout(1),
      observe("attempt", "protocol"),
      Effect.withTracer(tracer),
      Effect.provide(Logger.layer([]))
    )
  )
  assert.ok(Exit.isFailure(exit))
  assert.equal(
    spans
      .find((span) => span.name === "effect-jobs.execute")!
      .attributes.get("jobs.outcome"),
    "interrupted"
  )
  assert.equal(
    spans
      .find((span) => span.name === "effect-jobs.attempt")!
      .attributes.get("jobs.outcome"),
    "timeout"
  )
})
