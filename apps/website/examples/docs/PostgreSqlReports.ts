// Native SQL APIs are intentionally pinned to @effect/sql-pg 4.1.0.
// @effect-diagnostics unstableApiUsage:off
import { Effect, Layer, Match } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as JobWorker from "effect-jobs/JobWorker"
import * as JobStorage from "effect-jobs/JobStorage"
import * as JobPolling from "effect-jobs/JobPolling"
import { JobFailures } from "effect-jobs/JobFailure"
import { Database, generatedReports } from "./DrizzleReportRequest.js"
import {
  ReportHandlerLayer,
  ReportsQueue,
  type ReportPayload,
  ReportHandoff,
  ReportDefinitions,
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
    const { GeneratedReport } = yield* ReportDefinitions
    const db = yield* Database
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* jobs.withTransaction(() =>
      Effect.gen(function* () {
        yield* db
          .insert(generatedReports)
          .values({ reportId: payload.reportId, generatedBy: generatedJobId })
          .onConflictDoNothing({ target: generatedReports.reportId })

        yield* GeneratedReport.enqueue({
          slot: "deliver",
          operationId: generatedJobId,
          payload,
          policy: yield* ReportPolicy
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
    const definitions = yield* ReportDefinitions
    const client = yield* PgClient.PgClient
    const db = yield* Database
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs
    return ReportHandoff.of({
      record: (jobId, payload) =>
        recordGeneratedReport(jobId, payload).pipe(
          Effect.provideService(ReportDefinitions, definitions),
          Effect.provideService(PgClient.PgClient, client),
          Effect.provideService(Database, db),
          Effect.provideService(PostgreSqlJobs.PostgreSqlJobs, jobs)
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
export const makeWorkerLayer = (jobs: PostgreSqlJobs.Service, directory: string) =>
  Layer.unwrap(
    Effect.map(ReportDefinitions, (definitions) =>
      JobWorker.layer(definitions.ApplicationJobs, {
        queues: [{ queue: ReportsQueue, concurrency: 2 }]
      }).pipe(
        Layer.provide(ReportHandlerLayer),
        Layer.provide(DeliveryHandlerLayer),
        Layer.provide(ReportHandoffLayer),
        Layer.provide(localDeliveryLayer(directory)),
        Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage)),
        Layer.provide(NodeReportFiles.layer(directory))
      )
    )
  )

export const drainReports = (directory: string) =>
  Effect.gen(function* () {
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* jobs.ready
    return yield* JobWorker.drain(ReportsQueue, { maxJobs: 20, recoveryLimit: 20 }).pipe(
      Effect.provide(makeWorkerLayer(jobs, directory))
    )
  })
// #endregion worker

// #region polling
export const pollReports = (directory: string) =>
  Effect.gen(function* () {
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* jobs.ready
    const PollingLayer = JobPolling.layer([ReportsQueue], {
      maxJobs: 20,
      recoveryLimit: 20,
      shutdownGraceMillis: 30_000
    }).pipe(Layer.provide(makeWorkerLayer(jobs, directory)))
    return yield* Effect.never.pipe(Effect.provide(PollingLayer))
  }).pipe(Effect.scoped)
// Application shutdown interrupts polling by closing this Scope.
// #endregion polling
