// Application-owned synthetic OTLP sink, not a shipped library provider.
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
const require = createRequire(
  resolve(process.env.OBS_CONSUMER_ROOT ?? ".", "package.json")
)
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { Context, Effect, Fiber, Logger, Metric, Queue, Tracer } = await load("effect")
const { HttpClient, HttpClientResponse } = await load("effect/http")

// One worker, no retries. Drop telemetry under pressure, never queue job mutations.
export const limits = Object.freeze({
  queueItems: 64,
  queueBytes: 512 * 1024,
  itemBytes: 64 * 1024,
  sourceRecords: 32,
  requestMillis: 75,
  shutdownMillis: 350,
  captureItems: 64,
  captureBytes: 1024 * 1024
})
const admission = Metric.counter("synthetic_telemetry_admission_total", {
  incremental: true
})

const delivery = Metric.counter("synthetic_telemetry_delivery_total", {
  incremental: true
})

export const make = (urls) =>
  Effect.gen(function* () {
    const context = Context.add(
      yield* Effect.context(),
      Metric.CurrentMetricAttributes,
      {}
    )
    const queue = yield* Queue.dropping(limits.queueItems)
    const stats = {
      admitted: 0,
      delivered: 0,
      failed: 0,
      droppedQueue: 0,
      droppedOversize: 0,
      droppedSource: 0,
      droppedClosed: 0,
      droppedShutdown: 0,
      queuedItems: 0,
      queuedBytes: 0,
      inFlight: 0,
      inFlightBytes: 0,
      sourcePending: 0,
      maxQueuedItems: 0,
      maxQueuedBytes: 0,
      maxInFlight: 0,
      maxInFlightBytes: 0,
      maxSourcePending: 0,
      captureBytes: 0,
      closed: false
    }
    const captures = []
    const accepted = []
    const count = (outcome) =>
      Metric.withAttributes(admission, { outcome }).updateUnsafe(1, context)
    const source = () => {
      if (stats.closed || stats.sourcePending >= limits.sourceRecords) {
        stats.droppedSource++
        count("source-overflow")
        return false
      }
      stats.sourcePending++
      stats.maxSourcePending = Math.max(stats.maxSourcePending, stats.sourcePending)
      return true
    }
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        const allowed =
          request.url === urls.traces ||
          request.url === urls.logs ||
          request.url === urls.metrics
        if (!allowed) {
          throw new Error("Synthetic sink rejected an unconfigured endpoint")
        }
        const body = request.body._tag === "Uint8Array" ? request.body.body : undefined
        // Native maxBatchSize is a threshold. Release the actual number of records
        // in a coalesced frame, even when the threshold is one. Bodies here come
        // only from the pinned JSON serializer and our bounded synthetic sources.
        if (
          body !== undefined &&
          (request.url === urls.traces || request.url === urls.logs)
        ) {
          const data = JSON.parse(Buffer.from(body).toString("utf8"))
          const records =
            request.url === urls.traces
              ? data.resourceSpans.reduce(
                  (sum, resource) =>
                    sum +
                    resource.scopeSpans.reduce((n, scope) => n + scope.spans.length, 0),
                  0
                )
              : data.resourceLogs.reduce(
                  (sum, resource) =>
                    sum +
                    resource.scopeLogs.reduce(
                      (n, scope) => n + scope.logRecords.length,
                      0
                    ),
                  0
                )
          stats.sourcePending = Math.max(0, stats.sourcePending - records)
        }
        if (stats.closed) {
          stats.droppedClosed++
          count("closed")
        } else if (body === undefined || body.byteLength > limits.itemBytes) {
          stats.droppedOversize++
          count("oversize")
        } else if (
          stats.queuedItems >= limits.queueItems ||
          stats.queuedBytes + body.byteLength > limits.queueBytes
        ) {
          stats.droppedQueue++
          count("queue-overflow")
        } else {
          const item = { url: request.url, body: Uint8Array.from(body) }
          if (!Queue.offerUnsafe(queue, item)) {
            throw new Error("Queue accounting oracle")
          }
          stats.admitted++
          stats.queuedItems++
          stats.queuedBytes += item.body.byteLength
          stats.maxQueuedItems = Math.max(stats.maxQueuedItems, stats.queuedItems)
          stats.maxQueuedBytes = Math.max(stats.maxQueuedBytes, stats.queuedBytes)
          count("admitted")
          if (
            captures.length < limits.captureItems &&
            stats.captureBytes + body.byteLength <= limits.captureBytes
          ) {
            captures.push({ url: item.url, body: Buffer.from(body).toString("utf8") })
            stats.captureBytes += body.byteLength
          }
        }
        // This 202 acknowledges LOCAL admission/drop handling only, never remote delivery.
        return HttpClientResponse.fromWeb(request, new Response("{}", { status: 202 }))
      })
    )
    const worker = yield* Effect.gen(function* () {
      const item = yield* Queue.take(queue)
      stats.queuedItems--
      stats.queuedBytes -= item.body.byteLength
      stats.inFlight = 1
      stats.inFlightBytes = item.body.byteLength
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
      stats.maxInFlightBytes = Math.max(stats.maxInFlightBytes, stats.inFlightBytes)
      yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(item.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: item.body,
            signal
          })
          // Do not retain an unbounded response body or retry a failed export.
          await response.body?.cancel()
          return response.status
        },
        catch: () => "transport-unavailable"
      }).pipe(
        Effect.timeoutOption(limits.requestMillis),
        Effect.tap((status) =>
          Effect.sync(() => {
            if (status._tag === "Some" && status.value >= 200 && status.value < 300) {
              stats.delivered++
              Metric.withAttributes(delivery, { outcome: "delivered" }).updateUnsafe(
                1,
                context
              )
              if (accepted.length < limits.captureItems) {
                accepted.push({ url: item.url, status: status.value })
              }
            } else {
              stats.failed++
              Metric.withAttributes(delivery, {
                outcome: "transport-failed"
              }).updateUnsafe(1, context)
            }
          })
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            stats.failed++
            Metric.withAttributes(delivery, { outcome: "transport-failed" }).updateUnsafe(
              1,
              context
            )
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            stats.inFlight = 0
            stats.inFlightBytes = 0
          })
        )
      )
    }).pipe(Effect.forever, Effect.withTracerEnabled(false), Effect.forkScoped)
    const flush = Effect.whileLoop({
      while: () => stats.queuedItems > 0 || stats.inFlight > 0,
      body: () => Effect.sleep(1),
      step: () => {}
    })
    const close = Effect.gen(function* () {
      stats.closed = true
      yield* flush.pipe(Effect.interruptible, Effect.timeoutOption(limits.shutdownMillis))
      const interruptedRequest = stats.inFlight
      yield* Fiber.interrupt(worker)
      stats.droppedShutdown += stats.queuedItems + interruptedRequest
      if (stats.queuedItems + interruptedRequest > 0) {
        Metric.withAttributes(delivery, { outcome: "shutdown-drop" }).updateUnsafe(
          stats.queuedItems + interruptedRequest,
          context
        )
      }
      stats.queuedItems = 0
      stats.queuedBytes = 0
      yield* Queue.shutdown(queue)
    })
    yield* Effect.addFinalizer(() => close)
    return {
      client,
      stats,
      captures,
      accepted,
      flush,
      tracer: (host) =>
        Tracer.make({
          context: host.context,
          span(options) {
            // Source admission bounds native exporter records/fibers BEFORE buffering.
            // The synthetic app owns fixed bounded attributes/error values, not arbitrary host data.
            return options.sampled && source()
              ? host.span(options)
              : new Tracer.NativeSpan({ ...options, sampled: false })
          }
        }),
      logger: (host) =>
        Logger.make((entry) => {
          if (source()) {
            host.log(entry)
          }
        })
    }
  })
