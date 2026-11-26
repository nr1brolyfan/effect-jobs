import { Context, DateTime, Match, Duration, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as JobRetryPolicy from "effect-jobs/JobRetryPolicy"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobApi from "effect-jobs/JobApi"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures, type JobFailure } from "effect-jobs/JobFailure"

const reportIdPattern = /^[a-z0-9-]{1,64}$/

// #region definition
// Workers select this named queue; it groups jobs, not business requests.
export const ReportsQueue = Effect.runSync(JobQueue.make("reports"))
export type ReportPayload = typeof ReportPayload.Type
export const ReportPayload = Schema.Struct({
  reportId: Schema.String.pipe(Schema.check(Schema.isPattern(reportIdPattern))),
  rows: Schema.Array(
    Schema.Struct({
      product: Schema.String,
      units: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))
      )
    })
  ).pipe(Schema.check(Schema.isMaxLength(100)))
})

export const reportDefinitions = Effect.gen(function* () {
  const GenerateReport = yield* Job.make({
    name: "report.generate", // Work type used to select the installed handler.
    payload: ReportPayload // Omitted version is exactly 1.
  })

  // The business operation that produces work, distinct from the job name.
  const RequestReport = yield* JobProducer.make("report.request").pipe(
    JobProducer.withSlot("generate", GenerateReport, { queue: ReportsQueue })
  )

  const DeliverReport = yield* Job.make({
    name: "report.deliver",
    payload: ReportPayload
  })
  const GeneratedReport = yield* JobProducer.make("report.generated").pipe(
    JobProducer.withSlot("deliver", DeliverReport, { queue: ReportsQueue })
  )

  const GenerateJobs = yield* JobGroup.make("generate", { report: GenerateReport })
  const DeliverJobs = yield* JobGroup.make("deliver", { report: DeliverReport })
  const ApplicationJobs = yield* JobApi.make("reports").pipe(
    JobApi.addGroup(GenerateJobs),
    JobApi.addGroup(DeliverJobs)
  )
  return {
    GenerateReport,
    RequestReport,
    DeliverReport,
    GeneratedReport,
    GenerateJobs,
    DeliverJobs,
    ApplicationJobs
  }
})
export class ReportDefinitions extends Context.Service<
  ReportDefinitions,
  Effect.Success<typeof reportDefinitions>
>()("docs/ReportDefinitions") {}
export const ReportDefinitionsLayer = Layer.effect(ReportDefinitions, reportDefinitions)

export const ReportPolicy = JobPolicy.make({
  retry: JobRetryPolicy.fixed(Duration.seconds(5)).pipe(
    JobRetryPolicy.maxFinalizedAttempts(3)
  ),
  completedRetention: Duration.days(90), // From Completed; cleanup also respects app references.
  deadRetention: Duration.infinity // Keep Dead jobs until an explicit application decision.
})
// #endregion definition

// #region enqueue
export const enqueueReport = (operationId: string, payload: ReportPayload) =>
  Effect.gen(function* () {
    const { RequestReport } = yield* ReportDefinitions
    return yield* RequestReport.enqueue({
      slot: "generate",
      operationId,
      payload,
      policy: yield* ReportPolicy
    })
  })
// Requires JobEnqueue and the configured client's active transaction.
// operationId: exact opaque request ID, 1–256 UTF-8 bytes; reuse on safe business retries.
// (operation, operationId, slot) locates retained dedup evidence. Matching catalog
// (name, version) + semantic payload returns the first ID; changes conflict.
// A duplicate keeps its first policy. Deleting evidence ends this dedup window.
// #endregion enqueue

// #region standalone
export const enqueueStandaloneReport = (operationId: string, payload: ReportPayload) =>
  Effect.gen(function* () {
    const { RequestReport } = yield* ReportDefinitions
    return yield* RequestReport.enqueueStandalone({
      slot: "generate",
      operationId,
      payload,
      policy: yield* ReportPolicy
    })
  })
// #endregion standalone

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
export const ReportHandlerLayer = Layer.unwrap(
  Effect.map(ReportDefinitions, (definitions) =>
    JobGroup.handlers(definitions.GenerateJobs, (handlers) =>
      handlers.handle(
        "report",
        Effect.fn("Reports.generate")(function* (input) {
          const storage = yield* ReportStorage
          const handoff = yield* ReportHandoff
          // Stable artifact key + immutable report input make retrying this write safe.
          // The application must prevent reuse of reportId for a different report.
          yield* storage
            .put(input.payload.reportId, renderReport(input.payload))
            .pipe(
              Effect.mapError(() => JobFailures.Retry({ code: Codes.storageUnavailable }))
            )
          yield* handoff.record(input.context.jobId, input.payload)
        })
      )
    )
  )
)
// Captures ReportStorage and ReportHandoff when installed; importing this file starts no work.
// #endregion handler

// #region delivery

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
  handoff: "report_handoff_failed",
  conflict: "report_handoff_conflict"
})
export const DeliveryHandlerLayer = Layer.unwrap(
  Effect.map(ReportDefinitions, (definitions) =>
    JobGroup.handlers(definitions.DeliverJobs, (handlers) =>
      handlers.handle(
        "report",
        Effect.fn("Reports.deliver")(function* (input) {
          const delivery = yield* ReportDelivery
          yield* delivery.send(input.payload).pipe(
            Effect.catchTags({
              DeliveryBusy: () =>
                Effect.fail(JobFailures.Retry({ code: DeliveryCodes.busy })),
              DeliveryUncertain: () => Effect.fail(JobFailures.OutcomeUnknown())
            })
          )
        })
      )
    )
  )
)
// Retry requires a replay-safe destination. OutcomeUnknown preserves uncertainty;
// bounded lease recovery may invoke the handler again, so the destination still
// needs stable idempotency/reconciliation. It is not an exactly-once guarantee.
// #endregion delivery

// #region shared-failure-policy
type MailError =
  | { readonly _tag: "ProviderBusy"; readonly retryBeforeMillis?: unknown }
  | { readonly _tag: "RecipientRejected" }

const MailCodes = FailureCode.define({
  busy: "mail_provider_busy",
  invalidCutoff: "mail_invalid_retry_cutoff",
  rejected: "mail_recipient_rejected"
})

export const toMailJobFailure = (error: MailError) =>
  Match.value(error).pipe(
    Match.tag("ProviderBusy", ({ retryBeforeMillis }) => {
      if (retryBeforeMillis === undefined) {
        return JobFailures.Retry({ code: MailCodes.busy })
      }
      if (!Schema.is(JobPolicy.EpochMillis)(retryBeforeMillis)) {
        return JobFailures.Isolate({ code: MailCodes.invalidCutoff })
      }
      return JobFailures.Retry({
        code: MailCodes.busy,
        retryBefore: DateTime.makeUnsafe(retryBeforeMillis)
      })
    }),
    Match.tag("RecipientRejected", () => JobFailures.Dead({ code: MailCodes.rejected })),
    Match.exhaustive
  )

export const mailHandlers = (mail: {
  readonly sendConfirmation: (orderId: string) => Effect.Effect<void, MailError>
  readonly sendInvoice: (orderId: string) => Effect.Effect<void, MailError>
}) => ({
  confirmation: (orderId: string) =>
    mail.sendConfirmation(orderId).pipe(Effect.mapError(toMailJobFailure)),
  invoice: (orderId: string) =>
    mail.sendInvoice(orderId).pipe(Effect.mapError(toMailJobFailure))
})
// #endregion shared-failure-policy

// #region finalized-attempt-limit
export const threeFinalizedAttempts = JobPolicy.make({
  retry: JobRetryPolicy.fixed(Duration.seconds(5)).pipe(
    JobRetryPolicy.maxFinalizedAttempts(3)
  )
})
// #endregion finalized-attempt-limit
