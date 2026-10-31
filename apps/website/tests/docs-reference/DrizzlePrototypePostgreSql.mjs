// Only the exact disposable container/port owned by Qualify.mjs is used.
import assert from "node:assert/strict"
import { Effect, Exit, Cause } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import { pgTable, text, integer } from "drizzle-orm/pg-core"
import * as JobSchema from "effect-jobs/PostgreSqlDrizzleSchema"
import { JobBackendError } from "effect-jobs/JobEnqueue"
import {
  ReportsLayer,
  Database,
  requestReport,
  readReceipt,
  migrationSql,
  reportRequests,
  reportRequestReceipts
} from "../../examples/docs/DrizzleReportRequest.js"

const port = Number(process.env.DOCS_TEST_PG_PORT)
assert(Number.isInteger(port) && port > 0)
const ClientLayer = PgClient.layer({
  host: "127.0.0.1",
  port,
  username: "postgres",
  database: "postgres",
  connectTimeout: "2 seconds",
  idleTimeout: "2 seconds",
  startupParameters: {
    statement_timeout: "2000",
    lock_timeout: "1000",
    idle_in_transaction_session_timeout: "5000"
  }
})
const tables = JobSchema.makeJobTables({})
const audit = pgTable("prototype_transaction_audit", {
  tableName: text("table_name").notNull(),
  pid: integer("pid").notNull(),
  xid: text("xid").notNull()
})
const payload = {
  reportId: "prototype-report-1",
  rows: [{ product: "widget", units: 3 }]
}
// This program runs on a fresh public schema, separately from the older example.
await Effect.runPromise(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    for (const statement of migrationSql.split(";").filter((part) => part.trim())) {
      yield* pg.unsafe(statement)
    }
    // DDL instrumentation observes the real physical session and transaction.
    yield* pg.unsafe(
      "CREATE TABLE prototype_transaction_audit (table_name text NOT NULL, pid integer NOT NULL, xid text NOT NULL)"
    )
    yield* pg.unsafe(`CREATE FUNCTION prototype_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO prototype_transaction_audit VALUES (TG_TABLE_NAME, pg_backend_pid(), txid_current()::text); RETURN NEW; END $$`)
    for (const table of [
      "report_requests",
      "jobs",
      "job_payloads",
      "report_request_receipts"
    ]) {
      yield* pg.unsafe(
        `CREATE TRIGGER prototype_audit AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION prototype_audit()`
      )
    }
    yield* Effect.gen(function* () {
      const db = yield* Database
      const result = yield* requestReport("prototype-op-1", payload)
      assert.equal(result._tag, "Inserted")
      assert.deepEqual(yield* readReceipt("prototype-op-1"), [{ jobId: result.jobId }])
      const writes = yield* db.select().from(audit)
      assert.deepEqual(writes.map((row) => row.tableName).sort(), [
        "job_payloads",
        "jobs",
        "report_request_receipts",
        "report_requests"
      ])
      assert.equal(
        new Set(writes.map((row) => row.pid)).size,
        1,
        "same physical connection for all four writes"
      )
      assert.equal(
        new Set(writes.map((row) => row.xid)).size,
        1,
        "same physical transaction for all four writes"
      )
      const duplicate = yield* requestReport("prototype-op-1", payload)
      assert.equal(duplicate._tag, "AlreadyPresent")
      assert.equal(duplicate.jobId, result.jobId)
      assert.equal(
        (yield* db.select().from(audit)).length,
        4,
        "duplicate emits no inserts"
      )
      const conflict = yield* requestReport("prototype-op-1", {
        ...payload,
        rows: [{ product: "changed", units: 3 }]
      }).pipe(Effect.exit)
      assert(Exit.isFailure(conflict))
      assert.equal(Cause.squash(conflict.cause)._tag, "JobIntegrityConflict")
      // Failure at the LAST write must roll back request, job and payload too.
      yield* pg.unsafe(
        "ALTER TABLE report_request_receipts ADD CONSTRAINT prototype_reject CHECK (operation_id <> 'rollback-op')"
      )
      const rollback = yield* requestReport("rollback-op", {
        ...payload,
        reportId: "rollback-report"
      }).pipe(Effect.exit)
      assert(Exit.isFailure(rollback))
      assert.deepEqual(
        yield* db
          .select()
          .from(reportRequests)
          .where(eq(reportRequests.operationId, "rollback-op")),
        []
      )
      assert.deepEqual(
        yield* db
          .select()
          .from(tables.jobs)
          .where(eq(tables.jobs.operationId, "rollback-op")),
        []
      )
      assert.equal((yield* db.select().from(tables.payloads)).length, 1)
      assert.equal((yield* db.select().from(reportRequestReceipts)).length, 1)
      assert.equal(
        (yield* db.select().from(audit)).length,
        4,
        "trigger evidence rolls back with the whole transaction"
      )
      // Synthetic response loss AFTER a real durable COMMIT, not a network test.
      let invocations = 0
      const unknown = new JobBackendError({
        reason: "storage-failure",
        commitKnowledge: "Unknown"
      })
      const responseLostClient = {
        ...pg,
        /** @template A, E, R @param {Effect.Effect<A, E, R>} body */
        withTransaction: (body) => {
          invocations++
          return pg.withTransaction(body).pipe(Effect.flatMap(() => Effect.fail(unknown)))
        }
      }
      const lost = yield* requestReport("lost-response", {
        ...payload,
        reportId: "lost-response"
      }).pipe(Effect.provideService(PgClient.PgClient, responseLostClient), Effect.exit)
      assert(Exit.isFailure(lost))
      assert.equal(Cause.squash(lost.cause), unknown)
      assert.equal(invocations, 1, "no whole-operation replay")
      const receipt = yield* readReceipt("lost-response")
      assert.equal(
        receipt.length,
        1,
        "durable receipt reconciles synthetic response loss"
      )
      assert.deepEqual(yield* readReceipt("never-requested"), [])
    }).pipe(Effect.provide(ReportsLayer))
  }).pipe(Effect.provide(ClientLayer))
)
console.log(
  "PASS: canonical Drizzle request on real PG: four writes share PID/xid; commit/receipt; duplicate identity; semantic conflict; last-write constraint rolls back all four; synthetic post-durable-COMMIT response loss stays Unknown without replay and reconciles receipt; absent receipt remains absent. No network/server crash claim."
)
