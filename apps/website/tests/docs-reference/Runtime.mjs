import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Schema, Exit, Cause } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Registry from "effect-jobs/JobRegistry"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Files from "../../examples/docs/NodeReportFiles.js"
import {
  GenerateReport,
  ReportPayload,
  ReportHandlerLayer,
  ReportStorage,
  ReportHandoff,
  DeliverReport,
  DeliveryHandlerLayer,
  ReportDelivery,
  DeliveryBusy,
  DeliveryUncertain,
  ReportStorageUnavailable,
  renderReport,
  ReportsQueue
} from "../../examples/docs/ReportWorkflow.js"

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
  catalog: GenerateReport.catalog,
  producer: { operation: "report.request", operationId: "op-1", slot: "generate" },
  attemptNumber: 1
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
    const registry = yield* Registry.JobRegistry
    const handler = registry.find(GenerateReport.catalog)
    assert(handler, "handler must be installed before execution")
    yield* handler.execute(encoded, context)
    yield* handler.execute(encoded, context)
  }).pipe(
    Effect.provide(
      ReportHandlerLayer.pipe(
        Layer.provideMerge(Registry.layer),
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
      const registry = yield* Registry.JobRegistry
      return yield* registry.find(GenerateReport.catalog).execute(encoded, context)
    }).pipe(
      Effect.provide(
        ReportHandlerLayer.pipe(
          Layer.provideMerge(Registry.layer),
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
  assert.equal(Cause.squash(failed.cause)._tag, "Retry")
  const duplicate = await Effect.runPromiseExit(
    Consumer.make(ReportsQueue, {
      localConcurrency: 2,
      claimLimitPerRun: 20,
      recoveryLimitPerRun: 20
    }).pipe(Effect.flatMap((c) => Consumer.plan(c, c)))
  )
  assert(Exit.isFailure(duplicate))
  assert.equal(Cause.squash(duplicate.cause)._tag, "DuplicateJobConsumer")
  for (const [failure, expected] of [
    [new DeliveryBusy(), "Retry"],
    [new DeliveryUncertain(), "OutcomeUnknown"]
  ]) {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const registry = yield* Registry.JobRegistry
        return yield* registry
          .find(DeliverReport.catalog)
          .execute(encoded, { ...context, catalog: DeliverReport.catalog })
      }).pipe(
        Effect.provide(
          DeliveryHandlerLayer.pipe(
            Layer.provideMerge(Registry.layer),
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
    assert.equal(Cause.squash(result.cause)._tag, expected)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log(
  "payload/CSV/atomic-file/repeated-handler/retry/duplicate-plan negative controls PASS"
)
