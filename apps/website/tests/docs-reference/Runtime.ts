import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Schema, Exit, Cause } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Api from "effect-jobs/JobApi"
import * as Worker from "effect-jobs/JobWorker"
import * as Storage from "effect-jobs/JobStorage"
import * as Files from "../../examples/docs/NodeReportFiles.js"
import {
  ReportDefinitions,
  reportDefinitions,
  ReportPayload,
  ReportHandlerLayer,
  ReportStorage,
  ReportHandoff,
  DeliveryHandlerLayer,
  ReportDelivery,
  DeliveryBusy,
  DeliveryUncertain,
  ReportStorageUnavailable,
  renderReport,
  ReportsQueue
} from "../../examples/docs/ReportWorkflow.js"

const definitions = await Effect.runPromise(reportDefinitions)
const { GenerateReport, DeliverReport, GenerateJobs, DeliverJobs, ApplicationJobs } =
  definitions
const DefinitionsLayer = Layer.succeed(ReportDefinitions, definitions)

const payload = {
  reportId: "report-1",
  rows: [
    { product: 'a,"b', units: 3 },
    { product: "=SUM(A1)", units: 1 }
  ]
}
const encoded = await Effect.runPromise(Codec.encodeJobPayload(ReportPayload, payload))
assert.deepEqual(
  await Effect.runPromise(Codec.decodeJobPayload(ReportPayload, encoded)),
  payload
)
assert.equal(Schema.is(ReportPayload)({ ...payload, reportId: "../escape" }), false)
assert.equal(
  Schema.is(ReportPayload)({ ...payload, rows: [{ product: "x", units: -1 }] }),
  false
)
assert.equal(
  Schema.is(ReportPayload)({ ...payload, rows: Array(101).fill(payload.rows[0]) }),
  false
)
const tampered = { ...encoded, semanticProjectionBytes: new TextEncoder().encode("{}") }
assert.equal(
  Exit.isFailure(
    await Effect.runPromiseExit(Codec.decodeJobPayload(ReportPayload, tampered))
  ),
  true
)
assert.equal(renderReport(payload), 'product,units\r\n"a,""b",3\r\n"\'=SUM(A1)",1\r\n')
const context = {
  jobId: Schema.decodeSync((await import("effect-jobs/JobId")).JobId)("job-1"),
  catalog: {
    queue: "reports",
    name: GenerateReport.name,
    version: GenerateReport.version
  },
  producer: { operation: "report.request", operationId: "op-1", slot: "generate" },
  nextFinalizationNumber: 1
}
const directory = await mkdtemp(join(import.meta.dirname, "reports-"))
let handoffs = 0
const HandoffLayer = Layer.succeed(
  ReportHandoff,
  ReportHandoff.of({
    record: () =>
      Effect.sync(() => {
        handoffs++
      })
  })
)
try {
  const program = Effect.gen(function* () {
    const handlers = yield* GenerateJobs.handlers
    const handler = handlers.report
    assert(handler, "handler must be installed before execution")
    yield* handler(encoded, context)
    yield* handler(encoded, context)
  }).pipe(
    Effect.provide(
      ReportHandlerLayer.pipe(
        Layer.provide(DefinitionsLayer),
        Layer.provide(HandoffLayer),
        Layer.provide(Files.layer(directory))
      )
    )
  )
  await Effect.runPromise(program)
  assert.equal(handoffs, 2, "repeated generation must repeat the durable handoff")
  assert.equal(
    await readFile(join(directory, "report-1.csv"), "utf8"),
    renderReport(payload)
  )
  assert.deepEqual(await readdir(directory), ["report-1.csv"])
  const failed = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const handlers = yield* GenerateJobs.handlers
      return yield* handlers.report(encoded, context)
    }).pipe(
      Effect.provide(
        ReportHandlerLayer.pipe(
          Layer.provide(DefinitionsLayer),
          Layer.provide(HandoffLayer),
          Layer.provide(
            Layer.succeed(
              ReportStorage,
              ReportStorage.of({ put: () => Effect.fail(new ReportStorageUnavailable()) })
            )
          )
        )
      )
    )
  )
  assert(Exit.isFailure(failed))
  assert.equal(
    Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }))(
      Cause.squash(failed.cause)
    )._tag,
    "Retry"
  )
  assert.throws(
    // Runtime bypass preserves the catalog's duplicate-group negative control.
    () => ApplicationJobs.pipe(Api.addGroup(GenerateJobs) as never),
    (error: unknown) =>
      error instanceof Api.InvalidJobApi && error.reason === "duplicate-group"
  )
  const unexpectedStorage = () =>
    Effect.die("duplicate queues must fail before storage activity")
  const duplicateQueue = await Effect.runPromiseExit(
    Worker.make(Api.make("duplicate-queue-control").pipe(Api.addGroup(GenerateJobs)), {
      queues: [{ queue: ReportsQueue }, { queue: ReportsQueue }]
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Storage.JobStorage, {
            operationResponseBudgetMillis: 100,
            store: {
              claim: unexpectedStorage,
              reconcileClaim: unexpectedStorage,
              release: unexpectedStorage,
              finalize: unexpectedStorage,
              reconcileFinalization: unexpectedStorage,
              recoverExpired: unexpectedStorage
            }
          }),
          Layer.succeed(GenerateJobs.handlers, {
            report: () => Effect.die("duplicate queues must fail before invocation")
          })
        )
      )
    )
  )
  assert(Exit.isFailure(duplicateQueue))
  const duplicateReason = Cause.squash(duplicateQueue.cause)
  assert(duplicateReason instanceof Worker.JobWorkerConfigurationError)
  assert.equal(duplicateReason.field, "queues")
  for (const [failure, expected] of [
    [new DeliveryBusy(), "Retry"],
    [new DeliveryUncertain(), "OutcomeUnknown"]
  ] as const) {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const handlers = yield* DeliverJobs.handlers
        return yield* handlers.report(encoded, {
          ...context,
          catalog: {
            queue: "reports",
            name: DeliverReport.name,
            version: DeliverReport.version
          }
        })
      }).pipe(
        Effect.provide(
          DeliveryHandlerLayer.pipe(
            Layer.provide(DefinitionsLayer),
            Layer.provide(
              Layer.succeed(
                ReportDelivery,
                ReportDelivery.of({ send: () => Effect.fail(failure) })
              )
            )
          )
        )
      )
    )
    assert(Exit.isFailure(result))
    assert.equal(
      Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }))(
        Cause.squash(result.cause)
      )._tag,
      expected
    )
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log(
  "payload/CSV/atomic-file/repeated-handler/retry/duplicate-catalog/duplicate-queue negative controls PASS"
)
