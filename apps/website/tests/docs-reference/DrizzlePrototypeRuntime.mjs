// Real Drizzle builders and canonical Effects with a recording SQL boundary.
// This exercises query generation, parameters, order and error propagation, NOT PG atomicity.
import assert from "node:assert/strict"
import { Effect, Exit, Cause } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { EnqueueResults } from "effect-jobs/JobContract"
import { JobId } from "effect-jobs/JobId"
import { Schema } from "effect"
import {
  Database,
  requestReport,
  readReceipt
} from "../../examples/docs/DrizzleReportRequest.js"

const payload = { reportId: "report-1", rows: [{ product: "book", units: 3 }] }
const jobId = Schema.decodeSync(JobId)("prototype-job-1")
for (const failureAt of [undefined, "request", "enqueue", "receipt", "commit"]) {
  const events = []
  let active = false
  const fail = new Error(`synthetic-${failureAt}`)
  const client = {
    unsafe: (sql, parameters) => {
      const run = Effect.suspend(() => {
        assert(active, "Drizzle query must execute inside the owner's callback")
        const phase = sql.includes('"report_request_receipts"') ? "receipt" : "request"
        events.push({ phase, sql, parameters })
        return phase === failureAt ? Effect.fail(fail) : Effect.succeed([])
      })
      return { raw: run, withoutTransform: run, values: run }
    },
    /** @template A, E, R @param {Effect.Effect<A, E, R>} body */
    withTransaction: (body) =>
      Effect.suspend(() => {
        assert.equal(active, false, "Only one transaction owner")
        active = true
        events.push({ phase: "begin" })
        return body.pipe(
          Effect.flatMap((value) => {
            events.push({ phase: "commit" })
            return failureAt === "commit" ? Effect.fail(fail) : Effect.succeed(value)
          }),
          Effect.ensuring(
            Effect.sync(() => {
              active = false
            })
          )
        )
      })
  }
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const db = yield* Drizzle.makeWithDefaults()
      return yield* requestReport("operation-1", payload).pipe(
        Effect.provideService(Database, db)
      )
    }).pipe(
      Effect.provideService(PgClient.PgClient, client),
      Effect.provideService(JobEnqueue, {
        enqueue: (prepared) =>
          prepared.pipe(
            Effect.flatMap((job) => {
              assert(active, "Enqueue must share owner lifetime")
              assert.equal(job.producer.operationId, "operation-1")
              assert.equal(job.catalog.name, "report.generate")
              events.push({ phase: "enqueue" })
              return failureAt === "enqueue"
                ? Effect.fail(fail)
                : Effect.succeed(EnqueueResults.Inserted({ jobId }))
            })
          ),
        enqueueStandalone: () => Effect.die("Standalone must never be called")
      })
    )
  )
  const phases = events.map((event) => event.phase)
  assert.deepEqual(
    phases,
    {
      undefined: ["begin", "request", "enqueue", "receipt", "commit"],
      request: ["begin", "request"],
      enqueue: ["begin", "request", "enqueue"],
      receipt: ["begin", "request", "enqueue", "receipt"],
      commit: ["begin", "request", "enqueue", "receipt", "commit"]
    }[failureAt]
  )
  assert.equal(active, false)
  assert.equal(Exit.isSuccess(result), failureAt === undefined)
  if (failureAt === "enqueue" || failureAt === "commit") {
    assert.equal(
      Cause.squash(result.cause),
      fail,
      "Caller/commit error is not remapped to success or rollback knowledge"
    )
  }
  const request = events.find((event) => event.phase === "request")
  assert.match(request.sql, /insert into "report_requests"/)
  assert.deepEqual(request.parameters, ["operation-1", "report-1"])
  const receipt = events.find((event) => event.phase === "receipt")
  if (receipt) {
    assert.match(receipt.sql, /insert into "report_request_receipts"/)
    assert.deepEqual(receipt.parameters, ["operation-1", jobId])
  }
}
for (const rows of [[], [[jobId]]]) {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Drizzle.makeWithDefaults()
      return yield* readReceipt("operation-1").pipe(Effect.provideService(Database, db))
    }).pipe(
      Effect.provideService(PgClient.PgClient, {
        unsafe: (sql, parameters) => {
          assert.match(sql, /select "job_id" from "report_request_receipts" where/)
          assert.deepEqual(parameters, ["operation-1", 1])
          return { values: Effect.succeed(rows) }
        }
      })
    )
  )
  assert.deepEqual(result, rows.length ? [{ jobId }] : [])
}
console.log(
  "PASS: actual Drizzle query generation/binding, same recording-client owner, ordered request/enqueue/receipt, four short-circuit/commit failures, and present/absent receipt reads. Real PG transaction semantics NotTested."
)
