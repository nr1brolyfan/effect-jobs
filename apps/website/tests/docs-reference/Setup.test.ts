import { Effect, Layer, Schema } from "effect"
import { expect, it } from "vitest"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { EnqueueResult } from "effect-jobs/JobContract"
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
    Layer.provideMerge(DefinitionsLayer)
  )
  const payload = { reportId: "shared-report", rows: [{ product: "widget", units: 1 }] }
  await Effect.runPromise(
    Effect.gen(function* () {
      const definitions = yield* ReportDefinitions
      const handlers = yield* definitions.GenerateJobs.handlers
      const handler = handlers.report
      expect(handler).toBeDefined()
      const encoded = yield* Codec.encodeJobPayload(
        definitions.GenerateReport.payload,
        payload
      )
      yield* handler!(encoded, {
        jobId: Schema.decodeSync(JobId)("report-job"),
        catalog: {
          queue: "reports",
          name: definitions.GenerateReport.name,
          version: definitions.GenerateReport.version
        },
        producer: {
          operation: "report.request",
          operationId: "request",
          slot: "generate"
        },
        nextFinalizationNumber: 1
      })
      yield* enqueueReport("request", payload)
      yield* enqueueReport("request", payload)
      expect(catalogs).toHaveLength(2)
      expect(catalogs[0]).toEqual({
        queue: "reports",
        name: definitions.GenerateReport.name,
        version: definitions.GenerateReport.version
      })
      expect(catalogs[1]).toEqual({
        queue: "reports",
        name: definitions.GenerateReport.name,
        version: definitions.GenerateReport.version
      })
      expect(definitions.RequestReport.slots.generate.job).toEqual(
        definitions.GenerateReport
      )
      expect(definitions.GeneratedReport.slots.deliver.job).toEqual(
        definitions.DeliverReport
      )
    }).pipe(
      Effect.provide(graph),
      Effect.provideService(
        JobEnqueue,
        JobEnqueue.of({
          enqueue: (prepared) =>
            prepared.pipe(
              Effect.map((job) => {
                catalogs.push(job.catalog)
                return EnqueueResult.Inserted({
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
  expect(first.RequestReport.slots.generate.job).toEqual(first.GenerateReport)
  expect(second.RequestReport.slots.generate.job).toEqual(second.GenerateReport)
  expect(first.GeneratedReport.slots.deliver.job).toEqual(first.DeliverReport)
  expect(second.GeneratedReport.slots.deliver.job).toEqual(second.DeliverReport)
})
