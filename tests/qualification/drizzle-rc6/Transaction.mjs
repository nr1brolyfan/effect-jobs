import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Layer, Redacted } from "effect"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import { DrizzlePostgresClient, makeWithDefaults } from "drizzle-orm/postgres/effect"
import { pgTable, text } from "drizzle-orm/pg-core"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue, JobPersistenceError } from "effect-jobs/JobEnqueue"
import * as Group from "effect-jobs/JobGroup"
import { JobStorage } from "effect-jobs/JobStorage"
import { JobOwnershipLost } from "effect-jobs/JobStore"
import { JobFinalizations } from "effect-jobs/JobLifecycle"
import * as Worker from "effect-jobs/JobWorker"
import { migrationSql } from "./Migrations.js"
import { ReportsQueue, reportDefinitions } from "./ReportWorkflow.js"

const requests = pgTable("report_requests", {
  operationId: text("operation_id").primaryKey(),
  reportId: text("report_id").notNull()
})
const receipts = pgTable("report_request_receipts", {
  operationId: text("operation_id").primaryKey(),
  jobId: text("job_id").notNull()
})

// Run only against the fresh database allocated by Run.sh for this runtime.
const openJobs = (client) =>
  Jobs.make({ operationResponseBudget: Duration.millis(500) }).pipe(
    Effect.provideService(
      PostgreSqlApplication,
      Native.make({ client, operationTimeout: Duration.seconds(3) })
    )
  )

export const qualify = (url) => {
  const options = {
    url: Redacted.make(url),
    connectTimeout: "2 seconds",
    maxConnections: 3
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* DrizzlePostgresClient.DrizzlePostgresClient
      const db = yield* makeWithDefaults()
      const jobs = yield* openJobs(client)
      for (const sql of migrationSql.split(";").filter((s) => s.trim()))
        yield* client.unsafe(sql)
      yield* jobs.ready
      yield* client.unsafe(
        "create table write_audit (rel text not null, pid int not null, xid text not null)"
      )
      yield* client.unsafe(`create function record_write() returns trigger language plpgsql as $$
      begin insert into write_audit values (TG_TABLE_NAME, pg_backend_pid(), txid_current()::text); return NEW; end $$`)
      for (const table of [
        "report_requests",
        "jobs",
        "job_payloads",
        "report_request_receipts"
      ]) {
        yield* client.unsafe(
          `create trigger record_write after insert on ${table} for each row execute function record_write()`
        )
      }
      const { RequestReport } = yield* reportDefinitions
      const enqueue = (id) =>
        RequestReport.enqueue({
          slot: "generate",
          operationId: id,
          payload: { reportId: id, rows: [] }
        }).pipe(Effect.provideService(JobEnqueue, jobs.producer))
      const request = (id) =>
        client.withTransaction(
          Effect.gen(function* () {
            yield* db
              .insert(requests)
              .values({ operationId: id, reportId: id })
              .onConflictDoNothing()
            const result = yield* enqueue(id)
            yield* db
              .insert(receipts)
              .values({ operationId: id, jobId: result.jobId })
              .onConflictDoNothing()
            return result
          })
        )
      const rejected = (exit, reason) => {
        assert(Exit.isFailure(exit))
        assert.equal(Cause.squash(exit.cause).reason, reason)
      }
      rejected(yield* Effect.exit(enqueue("absent")), "transaction-required")
      const foreign = yield* Effect.gen(function* () {
        const other = yield* DrizzlePostgresClient.DrizzlePostgresClient
        assert.notEqual(other, client)
        return yield* Effect.exit(other.withTransaction(enqueue("foreign")))
      }).pipe(Effect.provide(DrizzlePostgresClient.layer(options)))
      rejected(foreign, "transaction-required")
      const results = yield* Effect.all([request("same"), request("same")], {
        concurrency: 2
      })
      assert.deepEqual(results.map((r) => r._tag).sort(), ["AlreadyPresent", "Inserted"])
      assert.equal(results[0].jobId, results[1].jobId)
      const audit = yield* client.unsafe("select * from write_audit order by rel")
      assert.deepEqual(
        audit.map((r) => r.rel),
        ["job_payloads", "jobs", "report_request_receipts", "report_requests"]
      )
      assert.equal(new Set(audit.map((r) => r.pid)).size, 1)
      assert.equal(new Set(audit.map((r) => r.xid)).size, 1)
      const interrupted = yield* Effect.exit(
        client.withTransaction(
          enqueue("interrupted").pipe(Effect.andThen(Effect.interrupt))
        )
      )
      assert(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause))
      yield* client.unsafe(
        "alter table report_request_receipts add check (operation_id <> 'rollback')"
      )
      assert(Exit.isFailure(yield* Effect.exit(request("rollback"))))
      assert.deepEqual(
        yield* client.unsafe("select * from write_audit order by rel"),
        audit
      )
      for (const table of [
        "report_requests",
        "jobs",
        "job_payloads",
        "report_request_receipts"
      ]) {
        assert.deepEqual(
          yield* client.unsafe(`select count(*)::int as n from ${table}`),
          [{ n: 1 }]
        )
      }
      // Inject a typed driver-control failure only after the real COMMIT resolves.
      // Caller-visible knowledge must remain Unknown even though the job persisted.
      let commits = 0
      const lost = yield* openJobs({
        transactionService: client.transactionService,
        withTransaction: (body) =>
          client.withTransaction(body).pipe(
            Effect.flatMap(() => {
              commits++
              return Effect.fail(
                new SqlError({
                  reason: new ConnectionError({ cause: "lost acknowledgement" })
                })
              )
            })
          )
      })
      const failure = yield* Effect.flip(
        RequestReport.enqueueStandalone({
          slot: "generate",
          operationId: "lost",
          payload: { reportId: "lost", rows: [] }
        }).pipe(Effect.provideService(JobEnqueue, lost.producer))
      )
      assert(failure instanceof JobPersistenceError)
      assert.equal(failure.commitKnowledge, "Unknown")
      assert.equal(commits, 1)
      assert.deepEqual(
        yield* client.unsafe("select operation_id from jobs order by operation_id"),
        [{ operation_id: "lost" }, { operation_id: "same" }]
      )
      // Simulate lease expiry without waiting for wall-clock time. The store,
      // not this fixture, must recover it and fence the original owner.
      const claimed = yield* jobs.store.claim({
        queue: ReportsQueue.name,
        supportedCatalog: [
          { queue: ReportsQueue.name, name: "report.generate", version: 1 }
        ],
        leaseToken: crypto.randomUUID()
      })
      assert.equal(claimed._tag, "Claimed")
      yield* client.unsafe("update jobs set lease_expires_at=1 where id=$1", [
        claimed.claim.ownership.jobId
      ])
      assert.equal(yield* jobs.store.recoverExpired(ReportsQueue.name, 1), 1)
      assert(
        (yield* Effect.flip(
          jobs.store.finalize({
            ownership: claimed.claim.ownership,
            before: claimed.claim.snapshot,
            finalization: JobFinalizations.Complete()
          })
        )) instanceof JobOwnershipLost
      )
      yield* client.unsafe("update jobs set available_at=1 where id=$1", [
        claimed.claim.ownership.jobId
      ])
    }).pipe(Effect.provide(DrizzlePostgresClient.layer(options)))
  )
}

// Invoked in a fresh scope in all runtimes, and from a real DO alarm in workerd.
export const drain = (url) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* DrizzlePostgresClient.DrizzlePostgresClient
      const jobs = yield* openJobs(client)
      const defs = yield* reportDefinitions
      const seen = []
      const layer = Worker.layer(defs.ApplicationJobs, {
        queues: [{ queue: ReportsQueue, concurrency: 1 }]
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JobStorage, jobs.storage),
            Group.handlers(defs.GenerateJobs, (h) =>
              h.handle("report", (input) =>
                Effect.sync(() => {
                  seen.push(input.payload.reportId)
                })
              )
            ),
            Group.handlers(defs.DeliverJobs, (h) =>
              h.handle("report", () => Effect.die("unexpected delivery"))
            )
          )
        )
      )
      const result = yield* Worker.drain(ReportsQueue, {
        maxJobs: 3,
        recoveryLimit: 3
      }).pipe(Effect.provide(layer))
      assert.equal(result._tag, "Idle")
      assert.equal(result.claimed, 2)
      assert.deepEqual(seen.sort(), ["lost", "same"])
      assert.deepEqual(
        yield* client.unsafe("select state, count(*)::int as n from jobs group by state"),
        [{ state: "Completed", n: 2 }]
      )
    }).pipe(
      Effect.provide(
        DrizzlePostgresClient.layer({
          url: Redacted.make(url),
          connectTimeout: "2 seconds"
        })
      )
    )
  )
