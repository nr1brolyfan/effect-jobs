import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Exit, Cause } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { migrationSql } from "../../examples/docs/Migrations.js"
import {
  GenerateReport,
  RequestReport,
  ReportPolicy,
  enqueueReport,
  renderReport
} from "../../examples/docs/ReportWorkflow.js"
import {
  recordGeneratedReport,
  drainReports
} from "../../examples/docs/PostgreSqlReports.js"

import { ReportsLayer, requestReport } from "../../examples/docs/DrizzleReportRequest.js"

// Only the disposable loopback container created by Qualify.mjs is connected here.
const port = Number(process.env.DOCS_TEST_PG_PORT)
assert(Number.isInteger(port) && port > 0)
const ClientLayer = PgClient.layer({
  host: "127.0.0.1",
  port,
  username: "postgres",
  database: "postgres",
  connectTimeout: "2 seconds",
  idleTimeout: "2 seconds"
})
const payload = { reportId: "report-1", rows: [{ product: "widget", units: 3 }] }
const directory = await mkdtemp(join(import.meta.dirname, "pg-reports-"))
try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* PgClient.PgClient
      // Migrate before constructing ReportsLayer, whose readiness check requires tables.
      for (const statement of migrationSql.split(";").filter((part) => part.trim())) {
        yield* client.unsafe(statement)
      }
      return yield* Effect.gen(function* () {
        const backend = yield* PostgreSqlJobs
        yield* backend.ready
        const missing = yield* enqueueReport("missing", payload).pipe(
          Effect.provideService(JobEnqueue, backend.producer),
          Effect.exit
        )
        assert(Exit.isFailure(missing), "ambient enqueue must reject missing transaction")
        assert.equal(Cause.squash(missing.cause)._tag, "JobBackendError")
        assert.equal(Cause.squash(missing.cause).reason, "transaction-required")
        const first = yield* requestReport("op-1", payload)
        const duplicate = yield* requestReport("op-1", payload)
        assert.equal(first._tag, "Inserted")
        assert.equal(duplicate._tag, "AlreadyPresent")
        assert.equal(first.jobId, duplicate.jobId)
        const changed = yield* requestReport("op-1", {
          ...payload,
          rows: [{ product: "changed", units: 3 }]
        }).pipe(Effect.exit)
        assert(Exit.isFailure(changed), "changed content must conflict")
        assert.equal(Cause.squash(changed.cause)._tag, "JobIntegrityConflict")
        const rolledBack = yield* client
          .withTransaction(
            Effect.gen(function* () {
              yield* client`INSERT INTO report_requests VALUES ('rollback-op', 'rollback-report')`
              yield* enqueueReport("rollback-op", {
                ...payload,
                reportId: "rollback-report"
              }).pipe(Effect.provideService(JobEnqueue, backend.producer))
              return yield* Effect.fail("application-rollback")
            })
          )
          .pipe(Effect.exit)
        assert(Exit.isFailure(rolledBack))
        assert.equal(
          (yield* client`SELECT * FROM report_requests WHERE operation_id = 'rollback-op'`)
            .length,
          0
        )
        assert.equal(
          (yield* client`SELECT * FROM jobs WHERE operation_id = 'rollback-op'`).length,
          0
        )
        const activeStandalone = yield* client
          .withTransaction(
            GenerateReport.enqueueStandalone({
              producer: RequestReport.identity({
                operationId: "standalone",
                slot: "generate"
              }),
              payload,
              policy: ReportPolicy
            }).pipe(Effect.provideService(JobEnqueue, backend.producer))
          )
          .pipe(Effect.exit)
        assert(
          Exit.isFailure(activeStandalone),
          "standalone must reject the active same-client transaction"
        )
        assert.equal(Cause.squash(activeStandalone.cause).reason, "active-transaction")
        const drain = yield* drainReports(directory)
        const nextDrain = yield* drainReports(directory)
        assert.equal(drain.claimed + nextDrain.claimed, 2)
        assert.equal(
          (yield* client`SELECT state FROM jobs WHERE id = ${first.jobId}`)[0].state,
          "Completed"
        )
        assert.equal((yield* client`SELECT * FROM jobs`).length, 2)
        yield* recordGeneratedReport(first.jobId, payload)
        assert.equal((yield* client`SELECT * FROM jobs`).length, 2)
        assert.equal((yield* client`SELECT * FROM generated_reports`).length, 1)
        const conflictingHandoff = yield* recordGeneratedReport(first.jobId, {
          ...payload,
          rows: [{ product: "changed", units: 1 }]
        }).pipe(Effect.exit)
        assert(Exit.isFailure(conflictingHandoff))
        assert.equal(Cause.squash(conflictingHandoff.cause)._tag, "Isolate")
        assert.equal((yield* client`SELECT * FROM generated_reports`).length, 1)
        const invalid = yield* requestReport("bad", {
          ...payload,
          reportId: "../escape"
        }).pipe(Effect.exit)
        assert(Exit.isFailure(invalid))
        assert.equal(Cause.squash(invalid.cause)._tag, "ReportRequestRejected")
      }).pipe(Effect.provide(ReportsLayer))
    }).pipe(Effect.provide(ClientLayer))
  )
  assert.equal(
    await readFile(join(directory, "report-1.csv"), "utf8"),
    renderReport(payload)
  )
  assert.equal(
    await readFile(join(directory, "delivered/report-1.csv"), "utf8"),
    renderReport(payload)
  )
  const runtime = process.versions.bun ? "bun" : "node"
  for (const mode of ["request", "drain", "drain"]) {
    const result = spawnSync(runtime, ["compiled/RunReports.js"], {
      cwd: import.meta.dirname,
      timeout: 20_000,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/postgres`,
        REPORT_MODE: mode,
        REPORT_DIRECTORY: directory,
        OPERATION_ID: "entrypoint-2",
        REPORT_ID: "entrypoint-2"
      }
    })
    assert.equal(result.status, 0, `complete entrypoint ${mode}: ${result.stderr}`)
  }
  assert.equal(
    await readFile(join(directory, "entrypoint-2.csv"), "utf8"),
    renderReport({ reportId: "entrypoint-2", rows: [{ product: "widget", units: 3 }] })
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log(
  "real PG same-client request/job commit, dedup, conflict, rollback, missing-transaction, active-standalone rejection and finite worker/file PASS"
)
