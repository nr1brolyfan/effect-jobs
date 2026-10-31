import { Context, Effect, Layer, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { eq } from "drizzle-orm"
import { pgTable, text } from "drizzle-orm/pg-core"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlNative from "effect-jobs/PostgreSqlNative"
import * as PostgreSqlDrizzleSchema from "effect-jobs/PostgreSqlDrizzleSchema"
import { OperationId } from "effect-jobs/JobIdentity"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { enqueueReport, ReportPayload } from "./ReportWorkflow.js"

// #region schema
const jobTables = PostgreSqlDrizzleSchema.makeJobTables({})
export const reportRequests = pgTable("report_requests", {
  operationId: text("operation_id").primaryKey(),
  reportId: text("report_id").notNull().unique()
})
export const reportRequestReceipts = pgTable("report_request_receipts", {
  operationId: text("operation_id")
    .primaryKey()
    .references(() => reportRequests.operationId),
  jobId: text("job_id")
    .notNull()
    .references(() => jobTables.jobs.id)
})
export const generatedReports = pgTable("generated_reports", {
  reportId: text("report_id")
    .primaryKey()
    .references(() => reportRequests.reportId),
  generatedBy: text("generated_by")
    .notNull()
    .unique()
    .references(() => jobTables.jobs.id)
})
// #endregion schema

export class Database extends Context.Service<
  Database,
  Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
>()("docs/Database") {}

// #region setup
// Build once for the application lifetime, with ONE host-owned PgClient Layer.
const DatabaseLayer = Layer.effect(Database, Drizzle.makeWithDefaults())
const ReportJobsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    const backend = yield* PostgreSqlJobs.make({
      operationResponseBudgetMillis: 100
    }).pipe(
      Effect.provide(
        PostgreSqlNative.layer({ client: pg, operationTimeoutMillis: 2_000 })
      )
    )
    yield* backend.ready
    return Layer.mergeAll(
      Layer.succeed(PostgreSqlJobs.PostgreSqlJobs, backend),
      Layer.succeed(JobEnqueue, backend.producer)
    )
  })
)
export const ReportsLayer = Layer.mergeAll(DatabaseLayer, ReportJobsLayer)
// ProvideMerge the same scoped PgClient Layer to ReportsLayer at composition;
// keep its PgClient output for requestReport. Close the app Scope at shutdown.
// #endregion setup

export class ReportRequestRejected extends Schema.TaggedError<ReportRequestRejected>()(
  "ReportRequestRejected",
  {}
) {}

// #region request
// Application authority/admission must precede this call.
export const requestReport = (operationId: string, payload: ReportPayload) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(ReportPayload)(payload).pipe(
      Effect.mapError(() => new ReportRequestRejected())
    )
    const identity = yield* Schema.decodeUnknownEffect(OperationId)(operationId).pipe(
      Effect.mapError(() => new ReportRequestRejected())
    )

    const db = yield* Database
    const pg = yield* PgClient.PgClient

    return yield* pg.withTransaction(
      Effect.gen(function* () {
        yield* db
          .insert(reportRequests)
          .values({ operationId: identity, reportId: decoded.reportId })
          .onConflictDoNothing({ target: reportRequests.operationId })

        const result = yield* enqueueReport(identity, decoded)

        yield* db
          .insert(reportRequestReceipts)
          .values({ operationId: identity, jobId: result.jobId })
          .onConflictDoNothing({ target: reportRequestReceipts.operationId })

        return result
      })
    )
  })
// #endregion request

// #region reconcile
// Read outside the uncertain transaction, on the application's primary database.
export const readReceipt = (operationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* db
      .select({ jobId: reportRequestReceipts.jobId })
      .from(reportRequestReceipts)
      .where(eq(reportRequestReceipts.operationId, operationId))
      .limit(1)
  })
// An absent receipt does not establish NotCommitted or authorize replay.
// #endregion reconcile

// Apply with the host migration tool before ReportsLayer; imports execute no DDL.
export { migrationSql } from "./Migrations.js"
