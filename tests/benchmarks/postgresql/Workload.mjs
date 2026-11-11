/* oxlint-disable effecttsgo/any-unknown-in-error-context, effecttsgo/unstable-api-usage -- Standalone JS load tooling uses the pinned native PgClient; exercised against disposable PostgreSQL. */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"
import pg from "pg"
import {
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Redacted,
  References,
  Schema
} from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Job from "../../../dist/Job.js"
import * as Queue from "../../../dist/JobQueue.js"
import * as Policy from "../../../dist/JobPolicy.js"
import * as Worker from "../../../dist/JobWorker.js"
import * as Consumer from "../../../dist/JobConsumer.js"
import * as WorkerRuntime from "../../../dist/JobWorkerRuntime.js"
import * as Registry from "../../../dist/JobRegistry.js"
import * as Codec from "../../../dist/JobPayloadCodec.js"
import * as Jobs from "../../../dist/postgresql/PostgreSqlJobs.js"
import * as Native from "../../../dist/postgresql/PostgreSqlNative.js"
import * as Tables from "../../../dist/postgresql/PostgreSqlSchema.js"
import { PostgreSqlApplication } from "../../../dist/postgresql/PostgreSqlTransaction.js"
import { Measurements, nextArrival, rates, healthChecks } from "./Support.mjs"

const {
  options,
  directory,
  connection: target
} = JSON.parse(readFileSync(process.argv[2], "utf8"))
// Explicit credentials/host/port/database: never select a target from environment variables.
const connection = {
  ...target,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  query_timeout: 6000,
  idle_in_transaction_session_timeout: 10000
}
const observer = new pg.Pool({ ...connection, max: 2, application_name: "soak-observer" })
const bystander = new pg.Pool({
  ...connection,
  max: 2,
  application_name: "soak-bystander"
})
let runtime
let running = false
let producing = false
let failed = false
let stage = "startup"
let window = new Measurements()
const totals = new Measurements()
const loops = []
const workerRuntimes = []
const stop = () => {
  failed = true
  running = false
  producing = false
}
observer.on("error", stop)
bystander.on("error", stop)
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
const count = (key, amount = 1) => {
  totals.count(key, amount)
  window.count(key, amount)
}
const record = (key, millis) => {
  totals.record(key, millis)
  window.record(key, millis)
}
const guard = async (body) => {
  try {
    await body()
  } catch {
    stop()
  }
}
const run = (effect) =>
  runtime.runPromise(
    effect.pipe(Effect.provideService(References.MinimumLogLevel, "None"))
  )
const confirmed = new WeakSet()
const measured = (name, effect, request) =>
  Effect.suspend(() => {
    const started = performance.now()
    return effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const outcome = Exit.isSuccess(exit)
            ? (exit.value?._tag ?? "Success")
            : "Failure"
          count(`${name}.${outcome}`)
          record(`${name}.${outcome}`, performance.now() - started)
          if (Exit.isSuccess(exit) && typeof exit.value === "number") {
            count(`${name}.rows`, exit.value)
          }
          if (
            request?.finalization._tag === "Complete" &&
            outcome === "Applied" &&
            !confirmed.has(request)
          ) {
            confirmed.add(request)
            count("completed.Applied")
            record(
              "completed.sinceEligible",
              Math.max(0, Date.now() - request.before.availableAt)
            )
          }
        })
      )
    )
  })

try {
  const deadline = performance.now() + 30000
  for (;;) {
    try {
      await observer.query("SELECT 1")
      break
    } catch {
      if (performance.now() >= deadline || failed) {
        throw new Error("Startup failed")
      }
      await delay(200)
    }
  }
  stage = "schema"
  const mapping = Tables.tables({ schema: "soak" })
  await observer.query("CREATE SCHEMA soak")
  await observer.query(Tables.migration(mapping))
  await observer.query(
    "CREATE TABLE soak.bystander (id integer PRIMARY KEY, value bigint NOT NULL); INSERT INTO soak.bystander VALUES (1,0)"
  )
  // Only setup/observer connections are privileged. Native workload has ordinary DML rights.
  await observer.query(`CREATE ROLE soak_runtime LOGIN PASSWORD '${target.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    GRANT USAGE ON SCHEMA soak TO soak_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA soak TO soak_runtime`)
  runtime = ManagedRuntime.make(
    PgClient.layer({
      host: target.host,
      port: target.port,
      database: target.database,
      username: "soak_runtime",
      password: Redacted.make(target.password),
      applicationName: "soak-workload",
      maxConnections: options.poolSize,
      connectTimeout: "3 seconds",
      startupParameters: {
        statement_timeout: "5000",
        lock_timeout: "2000",
        idle_in_transaction_session_timeout: "10000"
      }
    })
  )
  const settings =
    await observer.query(`SELECT name,setting,unit FROM pg_settings WHERE name IN
    ('server_version','shared_buffers','max_connections','autovacuum','autovacuum_naptime',
     'autovacuum_vacuum_scale_factor','autovacuum_vacuum_threshold','autovacuum_vacuum_cost_limit',
     'autovacuum_vacuum_cost_delay','fsync','synchronous_commit') ORDER BY name`)
  writeFileSync(
    join(directory, "postgres-settings.json"),
    JSON.stringify(settings.rows, null, 2)
  )
  stage = "composition"
  const client = await run(PgClient.PgClient)
  const native = Native.make({ client, operationTimeoutMillis: 5000 })
  const jobs = await run(
    Jobs.make({ ...mapping, operationResponseBudgetMillis: 1000 }).pipe(
      Effect.provideService(PostgreSqlApplication, native)
    )
  )
  await run(jobs.ready)
  const queues = Array.from({ length: options.queues }, (_, q) =>
    Queue.make(`soak.q${q}`)
  )
  const definitions = queues.flatMap((queue) =>
    Array.from({ length: options.kindsPerQueue }, (_, k) =>
      Job.make({
        name: `soak.kind${k}`,
        queue,
        payload: Schema.Struct({ data: Schema.String })
      })
    )
  )
  const churnPolicy = Policy.make({
    completedRetention: Duration.seconds(options.churnRetentionSeconds)
  })
  const enqueue = (
    sequence,
    policy,
    data = "x".repeat(options.payloadBytes),
    operation = "soak.load"
  ) => {
    const index = sequence % definitions.length
    return jobs.withTransaction((tx) =>
      definitions[index].enqueueInTransaction(tx, {
        producer: {
          operationId: String(sequence),
          slot: "work",
          operation
        },
        payload: { data },
        policy
      })
    )
  }
  stage = "history"
  if (options.history > 0) {
    const template = await run(
      enqueue(0, Policy.defaultPolicy, "h".repeat(options.payloadBytes), "soak.history")
    )
    await observer.query(
      `UPDATE soak.jobs SET state='Completed',attempts_made=1,lifecycle_version=2,
      completed_at=updated_at,cleanup_at=updated_at+$2::bigint WHERE id=$1`,
      [template.jobId, Policy.defaultPolicy.completedRetention.millis]
    )
    // Immutable synthetic live history, not simulated weeks of physical churn.
    await observer.query(
      `WITH inserted AS (
      INSERT INTO soak.jobs (id,operation,operation_id,slot,queue,kind,version,policy,state,
        available_at,updated_at,attempts_made,stalled_count,lifecycle_version,completed_at,cleanup_at)
      SELECT 'history-'||n,j.operation,'history-'||n,j.slot,j.queue,j.kind,j.version,j.policy,j.state,
        j.available_at,j.updated_at,j.attempts_made,j.stalled_count,j.lifecycle_version,j.completed_at,j.cleanup_at
      FROM soak.jobs j CROSS JOIN generate_series(1,$2::integer) n WHERE j.id=$1 RETURNING id
    ) INSERT INTO soak.job_payloads (job_id,format_version,payload,projection)
      SELECT inserted.id,p.format_version,p.payload,p.projection FROM inserted
      CROSS JOIN soak.job_payloads p WHERE p.job_id=$1`,
      [template.jobId, options.history - 1]
    )
  }
  await observer.query("VACUUM (ANALYZE) soak.jobs")
  await observer.query("VACUUM (ANALYZE) soak.job_payloads")
  const store = Object.fromEntries(
    Object.entries(jobs.store).map(([name, operation]) => [
      name,
      (...args) =>
        measured(
          name,
          operation(...args),
          name === "finalize" || name === "reconcileFinalization" ? args[0] : undefined
        )
    ])
  )
  const handlers = definitions.map((definition, index) =>
    definition.handlerLayer(
      ({ payload }) =>
        Effect.sync(() => {
          createHash("sha256").update(payload.data).digest()
        }).pipe(Effect.andThen(Effect.sleep(index % 2 === 0 ? 5 : 15))),
      Codec.decodeJobPayload
    )
  )
  // Independent worker instances/registries, shared finite native pool. No separate-process claim.
  for (let w = 0; w < options.workers; w++) {
    workerRuntimes.push(
      ManagedRuntime.make(
        Worker.layer(store, {
          catalog: definitions,
          operationResponseBudgetMillis: 1000
        }).pipe(Layer.provide(Layer.mergeAll(...handlers)), Layer.provide(Registry.layer))
      )
    )
  }
  const consumers = await Promise.all(
    queues.map((queue) =>
      run(
        Consumer.make(queue, {
          localConcurrency: options.concurrency,
          claimLimitPerRun: 20,
          recoveryLimitPerRun: 20
        })
      )
    )
  )
  const start = performance.now()
  const sample = async () => {
    const pending = (
      await observer.query(`SELECT count(*)::integer AS count,
      greatest(0,extract(epoch FROM clock_timestamp())*1000-min(available_at))::double precision AS oldest_millis
      FROM soak.jobs WHERE state IN ('Pending','RetryScheduled') AND available_at <= extract(epoch FROM clock_timestamp())*1000`)
    ).rows[0]
    const tables = (
      await observer.query(`SELECT relname,n_live_tup,n_dead_tup,n_tup_ins,n_tup_upd,n_tup_del,
      autovacuum_count,last_autovacuum,pg_relation_size(relid)::text AS heap_bytes,
      pg_indexes_size(relid)::text AS index_bytes,pg_total_relation_size(relid)::text AS total_bytes
      FROM pg_stat_user_tables WHERE schemaname='soak' ORDER BY relname`)
    ).rows
    const wal = (await observer.query("SELECT wal_bytes::text FROM pg_stat_wal")).rows[0]
    if (pending.count > 100000) {
      count("guard.pendingLimit")
      stop()
    }
    const result = {
      stage,
      elapsedMillis: performance.now() - start,
      pending,
      tables,
      wal,
      workloadConnections: (
        await observer.query(
          "SELECT state,count(*)::integer AS count FROM pg_stat_activity WHERE application_name='soak-workload' GROUP BY state ORDER BY state"
        )
      ).rows,
      rssBytes: process.memoryUsage().rss,
      ...totals.snapshot(),
      window: window.snapshot()
    }
    appendFileSync(join(directory, "samples.ndjson"), JSON.stringify(result) + "\n")
    window = new Measurements()
    return result
  }
  if (failed) {
    throw new Error("Interrupted during setup")
  }
  stage = "soak"
  const before = await sample()
  running = true
  producing = true
  const until = start + options.durationSeconds * 1000
  for (let lane = 0; lane < options.producers; lane++) {
    loops.push(
      guard(async () => {
        let previous = -1
        while (producing && running) {
          const arrival = nextArrival(
            performance.now(),
            start,
            lane,
            options.producers,
            options.rate,
            previous
          )
          previous = arrival.slot
          count("producer.missedSlots", arrival.missed)
          await delay(Math.max(0, arrival.due - performance.now()))
          if (!producing || !running || performance.now() >= until) {
            break
          }
          const sequence = arrival.slot * options.producers + lane
          if ((totals.counters["producer.offered"] ?? 0) >= 1000000 - options.history) {
            count("guard.jobBudget")
            stop()
            break
          }
          count("producer.offered")
          await run(
            measured(
              "enqueue",
              enqueue(
                sequence,
                sequence % options.churnEvery === 0 ? churnPolicy : Policy.defaultPolicy
              )
            )
          )
        }
      })
    )
  }
  for (const worker of workerRuntimes) {
    for (const consumer of consumers) {
      loops.push(
        guard(async () => {
          while (running) {
            const result = await worker.runPromise(
              measured("drain", WorkerRuntime.drain(consumer)).pipe(
                Effect.provideService(References.MinimumLogLevel, "None")
              )
            )
            if (result._tag !== "MoreWork") {
              await delay(20)
            }
          }
        })
      )
    }
  }
  loops.push(
    guard(async () => {
      while (running) {
        await run(measured("cleanup", jobs.cleanup.cleanup(500)))
        await delay(200)
      }
    })
  )
  loops.push(
    guard(async () => {
      while (running) {
        const began = performance.now()
        await bystander.query("UPDATE soak.bystander SET value=value+1 WHERE id=1")
        count("bystander.completed")
        record("bystander", performance.now() - began)
        await delay(100)
      }
    })
  )
  while (running && performance.now() < until) {
    await delay(Math.min(options.sampleMillis, Math.max(1, until - performance.now())))
    await sample()
  }
  producing = false
  const after = await sample()
  stage = "drain"
  const drainUntil = performance.now() + options.drainSeconds * 1000
  let final = after
  while (running && performance.now() < drainUntil) {
    const outstanding = (
      await observer.query(
        "SELECT count(*)::integer AS count FROM soak.jobs WHERE state IN ('Pending','Active','RetryScheduled')"
      )
    ).rows[0].count
    if (
      outstanding === 0 &&
      (totals.counters["enqueue.Inserted"] ?? 0) ===
        (totals.counters["producer.offered"] ?? 0)
    ) {
      break
    }
    await delay(200)
  }
  running = false
  await Promise.all(loops)
  stage = "final"
  final = await sample()
  const durable = (
    await observer.query(
      "SELECT state,count(*)::integer AS count FROM soak.jobs GROUP BY state ORDER BY state"
    )
  ).rows
  const history = (
    await observer.query(
      "SELECT count(*)::integer AS count FROM soak.jobs WHERE operation='soak.history'"
    )
  ).rows[0].count
  const orphanPayloads = (
    await observer.query(
      "SELECT count(*)::integer AS count FROM soak.job_payloads p LEFT JOIN soak.jobs j ON j.id=p.job_id WHERE j.id IS NULL"
    )
  ).rows[0].count
  const checks = healthChecks({
    counters: totals.counters,
    durable,
    history,
    orphanPayloads,
    options
  })
  const healthy = !failed && Object.values(checks).every(Boolean)
  writeFileSync(
    join(directory, "summary.json"),
    JSON.stringify(
      {
        status: failed ? "incomplete" : "completed",
        healthy,
        checks,
        options,
        offeredLoad: rates(before, after),
        before,
        after,
        final,
        totals: totals.snapshot(),
        durable,
        history,
        orphanPayloads,
        note: "Synthetic single-host soak, not production certification. 90% retained, 10% short-retention churn; no fault injection."
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({ directory, healthy, checks, offeredLoad: rates(before, after) })
  )
  if (!healthy) {
    process.exitCode = 1
  }
} catch {
  stop()
  writeFileSync(
    join(directory, "failure.json"),
    JSON.stringify({ status: "incomplete", stage })
  )
  console.error(`Workload incomplete during ${stage}; raw provider errors omitted`)
  process.exitCode = 1
} finally {
  running = false
  producing = false
  await Promise.allSettled(loops)
  for (const worker of workerRuntimes) {
    await worker.dispose()
  }
  await runtime?.dispose()
  await bystander.end()
  await observer.end()
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
