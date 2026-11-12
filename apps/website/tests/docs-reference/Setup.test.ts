import { Effect, Layer, Schema } from "effect"
import { expect, it } from "vitest"
import * as Registry from "effect-jobs/JobRegistry"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { EnqueueResults } from "effect-jobs/JobContract"
import { JobId } from "effect-jobs/JobId"
import {
  ReportDefinitions,
  reportDefinitions,
  ReportHandlerLayer,
  ReportStorage,
  ReportHandoff,
  enqueueReport
} from "../../examples/docs/ReportWorkflow.js"

it("shares one initialized report graph across handler installation and repeated enqueue", async () => {
  let constructions = 0
  let handled = 0
  let handoffs = 0
  const catalogs: unknown[] = []
  const DefinitionsLayer = Layer.effect(
    ReportDefinitions,
    reportDefinitions.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          constructions++
        })
      )
    )
  )
  const graph = ReportHandlerLayer.pipe(
    Layer.provide(
      Layer.succeed(
        ReportStorage,
        ReportStorage.of({
          put: () =>
            Effect.sync(() => {
              handled++
            })
        })
      )
    ),
    Layer.provide(
      Layer.succeed(
        ReportHandoff,
        ReportHandoff.of({
          record: () =>
            Effect.sync(() => {
              handoffs++
            })
        })
      )
    ),
    Layer.provideMerge(Registry.layer),
    Layer.provideMerge(DefinitionsLayer)
  )
  const payload = { reportId: "shared-report", rows: [{ product: "widget", units: 1 }] }
  await Effect.runPromise(
    Effect.gen(function* () {
      const definitions = yield* ReportDefinitions
      const registry = yield* Registry.JobRegistry
      const handler = registry.find(definitions.GenerateReport.catalog)
      expect(handler).toBeDefined()
      const encoded = yield* Codec.encodeJobPayload(
        definitions.GenerateReport.payload,
        payload
      )
      yield* handler!.execute(encoded, {
        jobId: Schema.decodeSync(JobId)("report-job"),
        catalog: definitions.GenerateReport.catalog,
        producer: {
          operation: "report.request",
          operationId: "request",
          slot: "generate"
        },
        attemptNumber: 1
      })
      yield* enqueueReport("request", payload)
      yield* enqueueReport("request", payload)
      expect(catalogs).toHaveLength(2)
      expect(catalogs[0]).toBe(definitions.GenerateReport.catalog)
      expect(catalogs[1]).toBe(definitions.GenerateReport.catalog)
      expect(definitions.RequestReport.slots.generate).toBe(definitions.GenerateReport)
      expect(definitions.GeneratedReport.slots.deliver).toBe(definitions.DeliverReport)
    }).pipe(
      Effect.provide(graph),
      Effect.provideService(
        JobEnqueue,
        JobEnqueue.of({
          enqueue: (prepared) =>
            prepared.pipe(
              Effect.map((job) => {
                catalogs.push(job.catalog)
                return EnqueueResults.Inserted({
                  jobId: Schema.decodeSync(JobId)("report-job")
                })
              })
            ),
          enqueueStandalone: () => Effect.die("unexpected standalone enqueue")
        })
      )
    )
  )
  expect(constructions).toBe(1)
  expect(handled).toBe(1)
  expect(handoffs).toBe(1)
})

it("creates independently owned report definitions when setup is executed again", () => {
  expect(Effect.isEffect(reportDefinitions)).toBe(true)
  const first = Effect.runSync(reportDefinitions)
  const second = Effect.runSync(reportDefinitions)
  expect(second).not.toBe(first)
  expect(second.GenerateReport).not.toBe(first.GenerateReport)
  expect(second.DeliverReport).not.toBe(first.DeliverReport)
  expect(second.RequestReport).not.toBe(first.RequestReport)
  expect(first.RequestReport.slots.generate).toBe(first.GenerateReport)
  expect(second.RequestReport.slots.generate).toBe(second.GenerateReport)
  expect(first.GeneratedReport.slots.deliver).toBe(first.DeliverReport)
  expect(second.GeneratedReport.slots.deliver).toBe(second.DeliverReport)
})
