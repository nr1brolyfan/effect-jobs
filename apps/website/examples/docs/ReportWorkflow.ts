import { Context, Duration, Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as JobPayloadCodec from "effect-jobs/JobPayloadCodec"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures, type JobFailure } from "effect-jobs/JobFailure"

// #region definition
// Workers select this named queue; it groups jobs, not business requests.
export const ReportsQueue = JobQueue.make("reports")
export type ReportPayload = typeof ReportPayload.Type
export const ReportPayload = Schema.Struct({
  reportId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))),
  rows: Schema.Array(
    Schema.Struct({
      product: Schema.String,
      units: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))
      )
    })
  ).pipe(Schema.check(Schema.isMaxLength(100)))
})

export const GenerateReport = Job.make({
  queue: ReportsQueue,
  name: "report.generate", // Work type used to select the installed handler.
  payload: ReportPayload // Omitted version is exactly 1.
})

// The business operation that produces work, distinct from the job kind.
export const RequestReport = JobProducer.make({
  operation: "report.request",
  slots: { generate: GenerateReport } // Named consequence within each request; not a workflow edge.
})

export const ReportPolicy = JobPolicy.make({
  maxAttempts: 3, // Finalized attempts including the first (1–100); not all invocations.
  retryDelay: Duration.seconds(5), // Fixed delay after Retry, not exponential backoff.
  completedRetention: Duration.days(90), // From Completed; cleanup also respects app references.
  deadRetention: Duration.infinity // Keep Dead jobs until an explicit application decision.
})
// #endregion definition

// #region enqueue
export const enqueueReport = (operationId: string, payload: ReportPayload) =>
  GenerateReport.enqueue({
    producer: RequestReport.identity({ operationId, slot: "generate" }),
    payload,
    policy: ReportPolicy
  })
// Requires JobEnqueue and the configured client's active transaction.
// operationId: exact opaque request ID, 1–256 UTF-8 bytes; reuse on safe business retries.
// (operation, operationId, slot) locates retained dedup evidence. Matching catalog
// (queue, kind, version) + semantic payload returns the first ID; changes conflict.
// A duplicate keeps its first policy. Deleting evidence ends this dedup window.
// #endregion enqueue

export class ReportStorageUnavailable extends Schema.TaggedError<ReportStorageUnavailable>()(
  "ReportStorageUnavailable",
  {}
) {}

// The application owns storage durability and idempotency at this boundary.
export class ReportStorage extends Context.Service<
  ReportStorage,
  {
    readonly put: (
      reportId: string,
      csv: string
    ) => Effect.Effect<void, ReportStorageUnavailable>
  }
>()("docs/ReportStorage") {}

// RFC-style CSV escaping; prefix spreadsheet formula initiators for exported text.
const cell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
export const renderReport = (payload: ReportPayload): string =>
  [
    "product,units",
    ...payload.rows.map((row) => `${cell(row.product)},${row.units}`)
  ].join("\r\n") + "\r\n"

export const Codes = FailureCode.define({
  storageUnavailable: "report_storage_unavailable"
})

export class ReportHandoff extends Context.Service<
  ReportHandoff,
  {
    readonly record: (
      generatedJobId: string,
      payload: ReportPayload
    ) => Effect.Effect<void, JobFailure>
  }
>()("docs/ReportHandoff") {}

// #region handler
export const ReportHandlerLayer = GenerateReport.handlerLayer(
  Effect.fn("Reports.generate")(function* (input) {
    const storage = yield* ReportStorage
    const handoff = yield* ReportHandoff
    // Stable artifact key + immutable report input make retrying this write safe.
    // The application must prevent reuse of reportId for a different report.
    yield* storage
      .put(input.payload.reportId, renderReport(input.payload))
      .pipe(Effect.mapError(() => JobFailures.Retry({ code: Codes.storageUnavailable })))
    yield* handoff.record(input.context.jobId, input.payload)
  }),
  JobPayloadCodec.decodeJobPayload
)
// Captures ReportStorage and ReportHandoff when installed; importing this file starts no work.
// #endregion handler

// #region delivery
export const DeliverReport = Job.make({
  queue: ReportsQueue,
  name: "report.deliver",
  payload: ReportPayload
})
export const GeneratedReport = JobProducer.make({
  operation: "report.generated",
  slots: { deliver: DeliverReport }
})

export class DeliveryBusy extends Schema.TaggedError<DeliveryBusy>()(
  "DeliveryBusy",
  {}
) {}
export class DeliveryUncertain extends Schema.TaggedError<DeliveryUncertain>()(
  "DeliveryUncertain",
  {}
) {}
export class ReportDelivery extends Context.Service<
  ReportDelivery,
  {
    readonly send: (
      payload: ReportPayload
    ) => Effect.Effect<void, DeliveryBusy | DeliveryUncertain>
  }
>()("docs/ReportDelivery") {}

export const DeliveryCodes = FailureCode.define({
  busy: "delivery_busy",
  uncertain: "delivery_uncertain",
  handoff: "report_handoff_failed",
  conflict: "report_handoff_conflict"
})
export const DeliveryHandlerLayer = DeliverReport.handlerLayer(
  Effect.fn("Reports.deliver")(function* (input) {
    const delivery = yield* ReportDelivery
    yield* delivery.send(input.payload).pipe(
      Effect.catchTags({
        DeliveryBusy: () => Effect.fail(JobFailures.Retry({ code: DeliveryCodes.busy })),
        DeliveryUncertain: () =>
          Effect.fail(JobFailures.OutcomeUnknown({ code: DeliveryCodes.uncertain }))
      })
    )
  }),
  JobPayloadCodec.decodeJobPayload
)
// Retry requires a replay-safe destination. OutcomeUnknown preserves uncertainty;
// bounded lease recovery may invoke the handler again, so the destination still
// needs stable idempotency/reconciliation. It is not an exactly-once guarantee.
// #endregion delivery
