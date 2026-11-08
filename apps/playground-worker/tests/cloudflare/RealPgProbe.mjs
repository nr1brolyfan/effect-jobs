// Qualification FFI: identical packed-library program on Node, Bun and workerd.
import assert from "node:assert/strict"
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Redacted,
  Schema
} from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Pg from "@effect/sql-pg/PgClient"
import * as Native from "effect-jobs/PostgreSqlNative"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Job from "effect-jobs/Job"
import * as Producer from "effect-jobs/JobProducer"
import * as Queue from "effect-jobs/JobQueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as Group from "effect-jobs/JobGroup"
import * as Worker from "effect-jobs/JobWorker"
import * as Storage from "effect-jobs/JobStorage"
import * as Wake from "../../src/cloudflare/WakeCycle.js"
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
        maxConnections: 4,
        prepare: false,
        connectTimeout: "2 seconds",
        idleTimeout: "1 second"
      })
      const adapter = Native.make({ client, operationTimeoutMillis: 2000 })
      const jobs = yield* Jobs.make({
        schema,
        operationResponseBudgetMillis: 500
      }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
      yield* jobs.ready
      checks.push("real connection and packed jobs readiness")
      const queue = Queue.make("cf-real")
      const definition = Job.make({
        kind: "synthetic",
        payload: Schema.String
      })
      const policy = yield* Policy.make({
        leaseDuration: Duration.millis(1800),
        attemptTimeout: Duration.millis(200),
        retry: Retry.fixed(Duration.millis(500)).pipe(Retry.maxFinalizedAttempts(2))
      })
      const input = (id, payload = id, availableAt) => ({
        operationId: id,
        slot: "one",
        payload,
        ...(availableAt === undefined ? {} : { availableAt })
      })
      const producer = Producer.make("cf.real").pipe(
        Producer.withSlot("one", definition, { queue, policy })
      )
      const catalog = {
        queue: queue.name,
        kind: definition.kind,
        version: definition.version
      }
      const sql = (text, values = []) => client.unsafe(text, values)
      const row = (id) =>
        sql(`SELECT * FROM ${schema}.jobs WHERE operation_id=$1`, [id]).pipe(
          Effect.map((r) => r[0])
        )
      const counts = (id) =>
        sql(
          `SELECT
    (SELECT count(*)::int FROM ${schema}.domain WHERE id=$1) AS domain,
    (SELECT count(*)::int FROM ${schema}.jobs WHERE operation_id=$1) AS jobs,
    (SELECT count(*)::int FROM ${schema}.receipts WHERE id=$1) AS receipts`,
          [id]
        ).pipe(Effect.map((r) => r[0]))
      const transact = (id, rollback) =>
        client.withTransaction(
          Effect.gen(function* () {
            const before = (yield* sql(
              "SELECT pg_backend_pid() AS pid, txid_current()::text AS xid"
            ))[0]
            yield* sql(`INSERT INTO ${schema}.domain VALUES ($1)`, [id])
            const job = yield* producer.enqueue(input(id))
            yield* sql(`INSERT INTO ${schema}.receipts VALUES ($1,$2)`, [id, job.jobId])
            const after = (yield* sql(
              "SELECT pg_backend_pid() AS pid, txid_current()::text AS xid"
            ))[0]
            const audit = (yield* sql(
              `SELECT pid,xid FROM ${schema}.audit WHERE job_id=$1`,
              [job.jobId]
            ))[0]
            assert.deepEqual(before, after)
            assert.deepEqual(before, audit)
            if (rollback) {
              return yield* Effect.fail("caller-rollback")
            }
            return job
          })
        )
      return yield* Effect.gen(function* () {
        const absent = yield* Effect.flip(producer.enqueue(input("outside")))
        assert.equal(absent.reason, "transaction-required")
        assert.equal(absent.commitKnowledge, "NotCommitted")
        yield* transact("commit", false)
        assert.deepEqual(yield* counts("commit"), { domain: 1, jobs: 1, receipts: 1 })
        assert(Exit.isFailure(yield* Effect.exit(transact("rollback", true))))
        assert.deepEqual(yield* counts("rollback"), { domain: 0, jobs: 0, receipts: 0 })
        checks.push(
          "no-active rejection; same-client pid/xid domain+job+receipt commit and rollback"
        )
        const duplicates = yield* Effect.all(
          [0, 1].map(() =>
            jobs.withTransaction(() => producer.enqueue(input("duplicate")))
          ),
          { concurrency: 2 }
        )
        assert.equal(duplicates[0].jobId, duplicates[1].jobId)
        assert.deepEqual(duplicates.map((r) => r._tag).sort(), [
          "AlreadyPresent",
          "Inserted"
        ])
        const conflicts = yield* Effect.all(
          ["a", "b"].map((value) =>
            Effect.exit(
              jobs.withTransaction(() => producer.enqueue(input("conflict", value)))
            )
          ),
          { concurrency: 2 }
        )
        assert.equal(conflicts.filter(Exit.isSuccess).length, 1)
        assert.equal(conflicts.filter(Exit.isFailure).length, 1)
        checks.push("concurrent matching and conflicting dedup races")
        // Isolate lifecycle cases using application-owned fixture DML, never executor code.
        yield* sql(`DELETE FROM ${schema}.receipts`)
        yield* sql(`DELETE FROM ${schema}.jobs`)
        const claim = () =>
          jobs.store.claim({
            queue: queue.name,
            supportedCatalog: [catalog],
            leaseToken: crypto.randomUUID()
          })
        const finish = (c, finalization) =>
          jobs.store.finalize({
            ownership: c.ownership,
            before: c.snapshot,
            finalization
          })
        const now = Number(
          (yield* sql(
            "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
          ))[0].now
        )
        yield* producer.enqueueStandalone(input("delayed", "delayed", now + 1000))
        assert.equal((yield* claim())._tag, "Empty")
        yield* Effect.sleep("1100 millis")
        const first = yield* claim()
        assert.equal(first._tag, "Claimed")
        yield* finish(first.claim, { _tag: "Retry", code: "temporary" })
        const retry = yield* row("delayed")
        assert.equal(retry.state, "RetryScheduled")
        assert.equal(Number(retry.available_at) - Number(retry.updated_at), 500)
        assert.equal((yield* claim())._tag, "Empty")
        yield* Effect.sleep("600 millis")
        const second = yield* claim()
        assert.equal(second._tag, "Claimed")
        yield* finish(second.claim, { _tag: "Complete" })
        assert.equal((yield* row("delayed")).state, "Completed")
        checks.push("DB-time delayed eligibility and persisted retry delay")
        yield* producer.enqueueStandalone(input("recovery"))
        const old = yield* claim()
        assert.equal(old._tag, "Claimed")
        const fixed = Number(old.claim.ownership.leaseExpiresAt)
        yield* Effect.sleep("1900 millis")
        assert(
          Exit.isFailure(yield* Effect.exit(finish(old.claim, { _tag: "Complete" })))
        )
        assert.equal(yield* jobs.store.recoverExpired(queue.name, 1), 1)
        const fresh = yield* claim()
        assert.equal(fresh._tag, "Claimed")
        assert.notEqual(fresh.claim.ownership.leaseToken, old.claim.ownership.leaseToken)
        assert.equal(Number(old.claim.ownership.leaseExpiresAt), fixed)
        assert(
          Exit.isFailure(yield* Effect.exit(finish(old.claim, { _tag: "Complete" })))
        )
        yield* finish(fresh.claim, { _tag: "Complete" })
        checks.push("real fixed lease expiry, bounded recovery and stale-owner fencing")
        const entered = yield* Deferred.make()
        const sleeping = client.withTransaction(
          Effect.gen(function* () {
            yield* sql(`INSERT INTO ${schema}.domain VALUES ('interrupted')`)
            yield* producer.enqueue(input("interrupted"))
            yield* Deferred.succeed(entered, undefined)
            yield* sql("SELECT pg_sleep(8)")
          })
        )
        const fiber = yield* Effect.forkScoped(sleeping)
        yield* Deferred.await(entered)
        yield* Effect.sleep("100 millis")
        yield* Fiber.interrupt(fiber)
        const interrupted = yield* Fiber.await(fiber)
        assert(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause))
        assert.deepEqual(yield* counts("interrupted"), {
          domain: 0,
          jobs: 0,
          receipts: 0
        })
        assert.equal(Number((yield* sql("SELECT 1 AS ok"))[0].ok), 1)
        checks.push("interruption during genuine SQL; rollback and reusable client")
        yield* producer.enqueueStandalone(input("worker"))
        let calls = 0
        const group = Group.make("cloudflare-real-pg", { synthetic: definition })
        const worker = Worker.layer(group, {
          queues: [{ queue, concurrency: 2 }]
        }).pipe(
          Layer.provide(Layer.succeed(Storage.JobStorage, jobs.storage)),
          Layer.provide(
            group.toLayer({
              synthetic: () =>
                Effect.sync(() => {
                  calls++
                })
            })
          )
        )
        const schedule =
          sql(`WITH t AS MATERIALIZED (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now)
      SELECT t.now,a.expires_at,
        (SELECT min(available_at) FROM ${schema}.jobs WHERE queue='cf-real' AND state IN ('Pending','RetryScheduled')) AS due,
        (SELECT min(lease_expires_at) FROM ${schema}.jobs WHERE queue='cf-real' AND state='Active') AS recovery
      FROM t,${schema}.activation a`).pipe(
            Effect.map(([r]) => ({
              expiresInMillis: Math.max(0, Number(r.expires_at) - Number(r.now)),
              dueInMillis:
                r.due === null ? null : Math.max(0, Number(r.due) - Number(r.now)),
              recoveryInMillis:
                r.recovery === null
                  ? null
                  : Math.max(0, Number(r.recovery) - Number(r.now))
            })),
            Effect.mapError(() => new Wake.WakeUnavailable())
          )
        yield* Wake.run(queue).pipe(
          Effect.provide(worker),
          Effect.provideService(Wake.WakeSchedule, { read: schedule }),
          Effect.provideService(Wake.WakeAlarm, alarm)
        )
        assert.equal(calls, 1)
        assert.equal((yield* row("worker")).state, "Completed")
        checks.push(
          "actual finite app wake/drain invokes handler and persists completion"
        )
        return {
          checks,
          postgres: "PASS",
          hosted: "NotTested",
          cpuCrashNetwork: "NotTested"
        }
      }).pipe(Effect.provideService(JobEnqueue, jobs.producer))
    })
  ).pipe(Effect.provide(Reactivity.layer), Effect.timeout("40 seconds"))
