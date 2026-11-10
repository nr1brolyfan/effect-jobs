// Native SQL APIs are intentionally pinned to @effect/sql-pg 4.0.5.
// @effect-diagnostics unstableApiUsage:off
import { Effect, Layer, Match } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as JobConsumer from "effect-jobs/JobConsumer"
import * as JobRegistry from "effect-jobs/JobRegistry"
import * as JobWorker from "effect-jobs/JobWorker"
import * as JobWorkerRuntime from "effect-jobs/JobWorkerRuntime"
import * as PollingJobWorker from "effect-jobs/PollingJobWorker"
import { JobFailures } from "effect-jobs/JobFailure"
import { Database, generatedReports } from "./DrizzleReportRequest.js"
import {
  GenerateReport,
  ReportHandlerLayer,
  ReportsQueue,
  type ReportPayload,
  ReportHandoff,
  DeliverReport,
  GeneratedReport,
  ReportPolicy,
  DeliveryHandlerLayer,
  ReportDelivery,
  DeliveryBusy,
  DeliveryCodes,
  renderReport,
  ReportStorage
} from "./ReportWorkflow.js"
import * as NodeReportFiles from "./NodeReportFiles.js"

// #region handoff
export const recordGeneratedReport = (generatedJobId: string, payload: ReportPayload) =>
  Effect.gen(function* () {
    const db = yield* Database
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* backend.withTransaction(() =>
      Effect.gen(function* () {
        yield* db
          .insert(generatedReports)
          .values({ reportId: payload.reportId, generatedBy: generatedJobId })
          .onConflictDoNothing({ target: generatedReports.reportId })

        yield* DeliverReport.enqueue({
          producer: GeneratedReport.identity({
            operationId: generatedJobId,
            slot: "deliver"
          }),
          payload,
          policy: ReportPolicy
        })
      })
    )
  }).pipe(
    Effect.mapError((error) =>
      Match.value(error).pipe(
        Match.when({ _tag: "JobIntegrityConflict" }, () =>
          JobFailures.Isolate({ code: DeliveryCodes.conflict })
        ),
        Match.when({ commitKnowledge: "Unknown" }, () =>
          JobFailures.OutcomeUnknown({ code: DeliveryCodes.handoff })
        ),
        Match.orElse(() => JobFailures.Retry({ code: DeliveryCodes.handoff }))
      )
    )
  )
// Acknowledged handoff records the reference and delivery job atomically.
// If finalization is later lost, repeating generation finds that delivery job.
// #endregion handoff

const ReportHandoffLayer = Layer.effect(
  ReportHandoff,
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient
    const db = yield* Database
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    return ReportHandoff.of({
      record: (jobId, payload) =>
        recordGeneratedReport(jobId, payload).pipe(
          Effect.provideService(PgClient.PgClient, client),
          Effect.provideService(Database, db),
          Effect.provideService(PostgreSqlJobs.PostgreSqlJobs, backend)
        )
    })
  })
)

// Synthetic local delivery writes an export to a second private directory.
// Replace the service at construction for a real idempotent destination.
const localDeliveryLayer = (directory: string) =>
  Layer.effect(
    ReportDelivery,
    Effect.gen(function* () {
      const storage = yield* ReportStorage
      return ReportDelivery.of({
        send: (payload) =>
          storage
            .put(payload.reportId, renderReport(payload))
            .pipe(Effect.mapError(() => new DeliveryBusy()))
      })
    })
  ).pipe(Layer.provide(NodeReportFiles.layer(`${directory}/delivered`)))

// #region worker
export const makeWorkerLayer = (backend: PostgreSqlJobs.Backend, directory: string) =>
  JobWorker.layer(backend.store, {
    catalog: [GenerateReport, DeliverReport],
    operationResponseBudgetMillis: 100
  }).pipe(
    Layer.provide(ReportHandlerLayer),
    Layer.provide(DeliveryHandlerLayer),
    Layer.provide(ReportHandoffLayer),
    Layer.provide(localDeliveryLayer(directory)),
    Layer.provide(JobRegistry.layer),
    Layer.provide(NodeReportFiles.layer(directory))
  )

export const reportConsumer = JobConsumer.make(ReportsQueue, {
  localConcurrency: 2,
  claimLimitPerRun: 20,
  recoveryLimitPerRun: 20
})

export const drainReports = (directory: string) =>
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* backend.ready
    const consumer = yield* reportConsumer
    return yield* JobWorkerRuntime.drain(consumer).pipe(
      Effect.provide(makeWorkerLayer(backend, directory))
    )
  })
// #endregion worker

// #region polling
export const pollReports = (directory: string) =>
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* backend.ready
    const consumer = yield* reportConsumer
    const plan = yield* JobConsumer.plan(consumer)
    const PollingLayer = PollingJobWorker.layerForPlan(plan).pipe(
      Layer.provide(makeWorkerLayer(backend, directory))
    )
    return yield* Effect.never.pipe(Effect.provide(PollingLayer))
  }).pipe(Effect.scoped)
// Application shutdown interrupts polling by closing this Scope.
// #endregion polling
