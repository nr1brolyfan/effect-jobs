import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Metric, Result, Schema } from "effect"
import { Pool } from "pg"
import { it } from "vitest"
import { readQualificationResource } from "../qualification/Resource.mjs"
import * as App from "../qualification/d6-pg/ApplicationTransactions.js"
import * as Adapter from "./Adapter.js"
import * as Jobs from "../../src/PostgreSqlJobs.js"
import * as Tables from "../../src/PostgreSqlSchema.js"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import { JobFinalizations } from "../../src/JobLifecycle.js"
import { PostgreSqlApplication } from "../../src/PostgreSqlTransaction.js"

const directory = process.env.D6_RESOURCE_DIRECTORY
it.skipIf(!directory)(
  "real PG bounded health, actual confirmed state and cleanup visibility",
  async () => {
    const ownership = readQualificationResource(directory!)
    const env = Object.fromEntries(
      readFileSync(`${directory}/postgres.env`, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=")
          return [line.slice(0, i), line.slice(i + 1)]
        })
    )
    const pool = new Pool({
      host: "127.0.0.1",
      port: Number(ownership.ports["5432/tcp"][0].HostPort),
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      max: 2,
      connectionTimeoutMillis: 500,
      query_timeout: 3000,
      statement_timeout: 2000
    })
    const mapping = Tables.tables({ schema: "observability_fixture" })
    let created = false
    try {
      await pool.query("CREATE SCHEMA observability_fixture")
      created = true
      await pool.query(Tables.migration(mapping))
      const queue = Queue.make("observability")
      const job = Job.make({ queue, kind: "supported", payload: Schema.String })
      const unsupported = Job.make({ queue, kind: "unsupported", payload: Schema.String })
      const adapter = Adapter.make(App.source(pool))
      await Effect.runPromise(
        Effect.gen(function* () {
          const backend = yield* Jobs.make({
            ...mapping,
            operationResponseBudgetMillis: 100
          }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
          const input = (id: string) => ({
            payload: "SYNTHETIC_PRIVATE_PAYLOAD",
            producer: { operation: "observability", operationId: id, slot: "run" },
            policy: Policy.defaultPolicy,
            availableAt: 1000
          })
          for (const id of ["one", "two", "three"]) {
            yield* backend.withTransaction((tx) =>
              job.enqueueInTransaction(tx, input(id))
            )
          }
          yield* backend.withTransaction((tx) =>
            unsupported.enqueueInTransaction(tx, input("unsupported"))
          )
          const health = yield* backend.health.sample({
            queue: queue.name,
            supportedCatalog: [job.catalog],
            limit: 1
          })
          assert.deepEqual(health.supported, {
            count: 1,
            saturated: true,
            oldestAt: 1000
          })
          assert.deepEqual(health.unsupported, {
            count: 1,
            saturated: false,
            oldestAt: 1000
          })
          assert.deepEqual(health.expired, { count: 0, saturated: false, oldestAt: null })
          const claim = yield* backend.store.claim({
            queue: queue.name,
            supportedCatalog: [job.catalog],
            leaseToken: globalThis.crypto.randomUUID()
          })
          assert.equal(claim._tag, "Claimed")
          if (claim._tag !== "Claimed") {
            throw new Error("claim oracle")
          }
          const result = yield* backend.store.finalize({
            before: claim.claim.snapshot,
            ownership: claim.claim.ownership,
            finalization: JobFinalizations.Complete()
          })
          assert.equal(result._tag, "Applied")
          const exact = yield* backend.health.sample({
            queue: queue.name,
            supportedCatalog: [job.catalog],
            limit: 500
          })
          assert.equal(exact.supported.count, 2)
          assert.equal(exact.supported.saturated, false)
          const metrics = yield* Metric.snapshot
          const transitions = metrics.filter(
            (metric) => metric.id === "effect_jobs_transition_total"
          )
          assert.equal(transitions.length, 1)
          assert.equal(transitions[0]!.attributes?.["jobs.state"], "Completed")
          assert.equal(
            transitions[0]!.type === "Counter" && transitions[0]!.state.count,
            1
          )
          // Invalid runtime input fails before SQL and does not replace the last healthy sample.
          const invalid = yield* backend.health
            .sample({ queue: queue.name, supportedCatalog: [job.catalog], limit: 501 })
            .pipe(Effect.result)
          assert.ok(Result.isFailure(invalid))
        }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
      )
    } finally {
      if (created) {
        await pool.query("DROP SCHEMA observability_fixture CASCADE")
      }
      await pool.end()
    }
  }
)
