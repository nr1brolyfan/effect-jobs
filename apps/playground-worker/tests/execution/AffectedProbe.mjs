// Affected original PG assertions only: provider outcomes/ledger and executor wakes.
// Reset, quota, authority and interruption receipts are reused for unchanged inputs.
import assert from "node:assert/strict"
import { Duration, Effect, Exit, Layer, Redacted } from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Pg from "@effect/sql-pg/PgClient"
import { SqlClient } from "effect/sql/SqlClient"
import * as Native from "effect-jobs/PostgreSqlNative"
import * as Backend from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Authority from "../../src/persistence/authority/PostgreSqlAuthority.js"
import * as Persistence from "../../src/persistence/commands/Persistence.js"
import {
  CommandPersistence,
  CommandTransactions
} from "../../src/persistence/commands/Transactions.js"
import * as Provider from "../../src/execution/PostgreSqlProvider.js"
import * as Executor from "../../src/execution/Executor.js"
import * as Application from "../../src/execution/Application.js"
import * as Definitions from "../../src/scenarios/Definitions.js"
import * as Plan from "../../src/scenarios/Plan.js"
import * as Documents from "../../src/scenarios/PrivateDocument.js"
import { WakeAlarm } from "../../src/cloudflare/WakeCycle.js"
import * as Retry from "effect-jobs/JobRetryPolicy"

/**
 * @param {string} url
 * @param {string} schema
 * @param {import("../../src/cloudflare/WakeCycle.js").WakeAlarm["Service"]} alarm
 * @param {string[]} checks
 */
export const probe = (url, schema, alarm, checks = []) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Pg.make({
        url: Redacted.make(url),
        minConnections: 0,
        maxConnections: 6,
        prepare: false,
        connectTimeout: "2 seconds",
        idleTimeout: "1 second"
      })
      const adapter = Native.make({ client, operationTimeoutMillis: 2000 })
      const backend = yield* Backend.make({
        schema,
        operationResponseBudgetMillis: 500
      }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
      yield* backend.ready
      const sql = (text, params = []) => client.unsafe(text, params)
      const services = yield* Authority.make(schema).pipe(
        Effect.provideService(JobEnqueue, backend.producer),
        Effect.provideService(SqlClient, client)
      )
      const command = yield* Persistence.make.pipe(
        Effect.provideService(CommandTransactions, services.transactions),
        Effect.provideService(JobEnqueue, backend.producer)
      )
      const provider = yield* Provider.make(schema).pipe(
        Effect.provideService(SqlClient, client)
      )
      const issue = () => services.authority.issue()
      const authenticate = (issued) => services.authority.authenticate(issued.credential)
      const a = yield* issue()
      yield* sql(`UPDATE ${schema}.sandboxes SET next_generation_at=expires_at`)
      const access = yield* authenticate(a)
      const current = () => access.sandbox.ref
      const run = (requestId, scenario = "success", count = 1) =>
        command.run(access, { sandbox: current(), requestId, scenario, count })
      const queryJob = (id) =>
        sql(`SELECT * FROM ${schema}.jobs WHERE id=$1`, [id]).pipe(
          Effect.map((rows) => rows[0])
        )
      const shortPolicy = yield* Policy.make({
        leaseDuration: Duration.millis(1800),
        attemptTimeout: Duration.millis(200),
        retry: Retry.fixed(Duration.millis(500)).pipe(Retry.maxAttempts(3))
      })
      const produce = (id, behavior = "success", availableAt) =>
        backend.withTransaction(() =>
          Effect.gen(function* () {
            const [job] = yield* Plan.plan(
              { sandbox: current(), requestId: id, scenario: "success", count: 1 },
              current(),
              0,
              availableAt
            )
            const produced = yield* Plan.enqueue({
              ...job,
              policy: shortPolicy,
              payload: { ...job.payload, behavior }
            })
            yield* sql(
              `UPDATE ${schema}.sandboxes SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1`,
              [current().sandboxId]
            )
            yield* sql(
              `INSERT INTO ${schema}.associations VALUES ($1,$2,$3,'{}'::jsonb)`,
              [current().sandboxId, current().generation, produced.jobId]
            )
            return {
              jobId: produced.jobId,
              job: { ...job, payload: { ...job.payload, behavior } }
            }
          })
        )
      const providerCommand = (job) =>
        Codec.encodeJobPayload(Definitions.Payload, job.payload).pipe(
          Effect.map((encoded) => ({
            sandbox: job.payload.sandbox,
            producer: job.producer,
            workload: job.workload,
            behavior: job.payload.behavior,
            semanticProjection: encoded.semanticProjectionBytes
          }))
        )
      let hints = 0
      const workerLayer = Application.layerNoDeps(schema).pipe(
        Layer.provide(Layer.succeed(Backend.PostgreSqlJobs, backend))
      )
      const wake = (queue = "playground-communications") =>
        Executor.run(schema, queue).pipe(
          Effect.provide(workerLayer),
          Effect.provideService(CommandPersistence, command),
          Effect.provideService(Backend.PostgreSqlJobs, backend),
          Effect.provideService(SqlClient, client),
          Effect.provideService(WakeAlarm, alarm),
          Effect.provideService(Executor.ExecutionHints, {
            reconcile: Effect.sync(() => {
              hints++
            })
          })
        )

      const beforeInitial = (yield* sql(
        `SELECT count(*)::int AS n FROM ${schema}.jobs`
      ))[0].n
      const initial = yield* run("dedup", "deduplication", 6)
      assert.equal(initial._tag, "Committed")
      assert.deepEqual(yield* run("dedup", "deduplication", 6), initial)
      assert.equal(
        (yield* sql(`SELECT count(*)::int AS n FROM ${schema}.jobs`))[0].n,
        beforeInitial + 6
      )
      const queues = yield* Executor.consumers
      assert.deepEqual(
        queues.map((q) => q.queue.name),
        Executor.queueNames
      )
      for (const queue of Executor.queueNames) {
        yield* wake(queue)
      }
      assert(
        (yield* sql(`SELECT state FROM ${schema}.jobs WHERE id=ANY($1::text[])`, [
          initial.jobIds
        ])).every((r) => r.state === "Completed")
      )
      assert.equal(
        (yield* sql(
          `SELECT count(*)::int AS n FROM ${schema}.provider_ledger WHERE accepted=true AND job_id=ANY($1::text[])`,
          [initial.jobIds]
        ))[0].n,
        6
      )
      assert.equal(hints, 4)
      checks.push(
        "actual four fixed consumers, six real handlers, private codec, durable completion and hints"
      )

      const retry = yield* produce("retry", "retry-then-success")
      yield* wake()
      assert.equal((yield* queryJob(retry.jobId)).state, "RetryScheduled")
      yield* wake()
      assert.equal((yield* queryJob(retry.jobId)).state, "RetryScheduled")
      yield* Effect.sleep("600 millis")
      yield* wake()
      assert.equal((yield* queryJob(retry.jobId)).state, "Completed")
      const now = Number(
        (yield* sql(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
        ))[0].now
      )
      const delayed = yield* produce("delay", "success", now + 700)
      yield* wake()
      assert.equal((yield* queryJob(delayed.jobId)).state, "Pending")
      yield* Effect.sleep("800 millis")
      yield* wake()
      assert.equal((yield* queryJob(delayed.jobId)).state, "Completed")
      checks.push("DB-time delayed and retry wake cycles with actual scenario consumers")

      const lost = yield* produce("lost", "accepted-response-lost")
      const pc = yield* providerCommand(lost.job)
      assert.equal((yield* Effect.flip(provider.execute(pc)))._tag, "ResponseLost")
      const raced = yield* Effect.all([provider.execute(pc), provider.execute(pc)], {
        concurrency: 2
      })
      assert.equal(raced.length, 2)
      const entry = (yield* sql(
        `SELECT * FROM ${schema}.provider_ledger WHERE job_id=$1`,
        [lost.jobId]
      ))[0]
      assert.equal(entry.accepted, true)
      assert.equal(entry.invocations, 3)
      yield* wake()
      assert.equal((yield* queryJob(lost.jobId)).state, "Completed")
      const conflict = yield* Effect.flip(
        provider.execute({ ...pc, semanticProjection: new Uint8Array([42]) })
      )
      assert.equal(conflict._tag, "PayloadConflict")
      checks.push(
        "response loss after durable acceptance; concurrent ledger retries cause one synthetic effect"
      )

      const unknownWorker = yield* produce("unknown-worker", "accepted-response-lost")
      yield* wake()
      assert.equal((yield* queryJob(unknownWorker.jobId)).state, "Active")
      yield* Effect.sleep("1900 millis")
      yield* wake()
      assert.equal((yield* queryJob(unknownWorker.jobId)).state, "Completed")
      const dead = yield* produce("dead-worker", "dead")
      const isolated = yield* produce("isolated-worker", "isolated")
      yield* wake()
      assert.equal((yield* queryJob(dead.jobId)).state, "Dead")
      assert.equal((yield* queryJob(isolated.jobId)).state, "Isolated")
      checks.push(
        "real OutcomeUnknown retains ownership until recovery; durable dead/isolated handlers"
      )
      const recovering = yield* produce("recover")
      const old = yield* backend.store.claim({
        queue: Definitions.WelcomeEmail.queue.name,
        supportedCatalog: [Definitions.WelcomeEmail.catalog],
        leaseToken: crypto.randomUUID()
      })
      assert.equal(old._tag, "Claimed")
      yield* Effect.sleep("1900 millis")
      yield* wake()
      assert.equal((yield* queryJob(recovering.jobId)).state, "Completed")
      const stale = yield* Effect.exit(
        backend.store.finalize({
          ownership: old.claim.ownership,
          before: old.claim.snapshot,
          finalization: { _tag: "Complete" }
        })
      )
      assert(Exit.isFailure(stale))
      checks.push("bounded actual expired-lease recovery and stale finalization fencing")

      // Zero viewers retires ALL fixed queues; renewing describe resumes the same generation.
      yield* sql(`UPDATE ${schema}.sandboxes SET viewer_until=0`)
      const paused = yield* produce("paused")
      assert.equal((yield* wake())._tag, "Retired")
      assert.equal((yield* queryJob(paused.jobId)).state, "Pending")
      yield* services.authority.describe(access)
      yield* wake()
      assert.equal((yield* queryJob(paused.jobId)).state, "Completed")
      yield* sql(
        `UPDATE ${schema}.sandboxes SET next_generation_at=0 WHERE sandbox_id=$1`,
        [current().sandboxId]
      )
      const beforeCount = (yield* sql(`SELECT count(*)::int AS n FROM ${schema}.jobs`))[0]
        .n
      yield* wake()
      assert.equal(
        (yield* sql(`SELECT count(*)::int AS n FROM ${schema}.jobs`))[0].n,
        beforeCount + 1
      )
      yield* wake()
      assert.equal(
        (yield* sql(`SELECT count(*)::int AS n FROM ${schema}.jobs`))[0].n,
        beforeCount + 1
      )
      checks.push(
        "unattended global retirement, describe reactivation, bounded due generation"
      )

      return { status: "PASS", checks, hosted: "NotTested", scheduledAlarm: "NotTested" }
    }).pipe(Effect.provide(Documents.keysLayer))
  ).pipe(Effect.provide(Reactivity.layer), Effect.timeout("50 seconds"))
