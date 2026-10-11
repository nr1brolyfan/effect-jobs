// Application-owned disposable migrations and pool; no existing resources/secrets.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Effect } from "effect"
import { Pool } from "pg"
import * as Tables from "effect-jobs/PostgreSqlSchema"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { probe } from "./RealPgProbe.mjs"
const config = JSON.parse(readFileSync(process.env.CF_PRIVATE_CONFIG, "utf8"))
const evidence = process.env.CF_EVIDENCE
const runtime = process.versions.bun ? "bun" : "node"
const url = `postgres://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}`
const admin = new Pool({
  ...config,
  host: "127.0.0.1",
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000
})
const report = {
  runtime,
  version: process.versions.bun ?? process.version,
  startedAt: new Date().toISOString(),
  checks: [],
  hosted: "NotTested"
}
const schemas = runtime === "node" ? ["cf_node", "cf_workerd"] : ["cf_bun"]
let mf
try {
  report.serverVersion = (await admin.query("SHOW server_version")).rows[0].server_version
  assert.match(report.serverVersion, /^16\.15/)
  for (const schema of schemas) {
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.query(Tables.migration(Tables.tables({ schema })))
    await admin.query(`CREATE TABLE ${schema}.activation(expires_at bigint);
      INSERT INTO ${schema}.activation VALUES (floor(extract(epoch FROM clock_timestamp())*1000)::bigint+60000);
      CREATE TABLE ${schema}.domain(id text PRIMARY KEY);
      CREATE TABLE ${schema}.receipts(id text PRIMARY KEY REFERENCES ${schema}.domain(id),job_id text REFERENCES ${schema}.jobs(id));
      CREATE TABLE ${schema}.audit(job_id text,pid int,xid text);
      CREATE FUNCTION ${schema}.audit_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO ${schema}.audit VALUES (NEW.id,pg_backend_pid(),txid_current()::text); RETURN NEW; END $$;
      CREATE TRIGGER audit_job AFTER INSERT ON ${schema}.jobs FOR EACH ROW EXECUTE FUNCTION ${schema}.audit_job();`)
  }
  let alarmAt = null
  report.local = await Effect.runPromise(
    probe(
      url,
      `cf_${runtime}`,
      {
        set: (at) =>
          Effect.sync(() => {
            alarmAt = at
          }),
        clear: Effect.sync(() => {
          alarmAt = null
        })
      },
      report.checks
    )
  )
  assert(alarmAt !== null)
  if (runtime === "node") {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: readFileSync("RealPgWorker.js", "utf8"),
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { PROBE: { className: "RealProbe", useSQLite: true } },
        durableObjectsPersist: false,
        hyperdrives: { PG: url },
        outboundService: () => new Response("HTTP denied", { status: 403 })
      })
    )
    const response = await mf.dispatchFetch("https://probe.invalid/real-pg")
    report.workerd = await response.json()
    assert.equal(response.status, 200)
    assert.equal(report.workerd.nativeAlarmSet, true)
  }
  report.status = "PASS"
} catch (error) {
  // Raw SQL/provider Cause may include credentials; retain only bounded failure category.
  report.status = "FAIL"
  report.failureClass = error?.constructor?.name ?? "Unknown"
  report.assertionCode = error?.code === "ERR_ASSERTION" ? "ERR_ASSERTION" : undefined
  process.exitCode = 1
} finally {
  if (mf) {
    await mf.dispose()
  }
  // Scope exit must leave no driver sessions or active SQL in these task-only DB schemas.
  report.remainingSessions = (
    await admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
    )
  ).rows[0].n
  if (report.remainingSessions !== 0) {
    report.status = "FAIL"
    report.cleanupFailure = "driver sessions remain after Scope exit"
    process.exitCode = 1
  }
  for (const schema of schemas) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  }
  await admin.end()
  report.finishedAt = new Date().toISOString()
  writeFileSync(
    `${evidence}/${runtime}-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
