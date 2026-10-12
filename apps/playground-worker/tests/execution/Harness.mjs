// Filesystem/native harness FFI; no credentials or raw driver errors in receipts.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Effect } from "effect"
import { Pool } from "pg"
import * as Jobs from "effect-jobs/PostgreSqlSchema"
import * as Authority from "./dist/src/persistence/authority/Schema.js"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { probe } from "./Probe.mjs"
const cfg = JSON.parse(readFileSync(process.env.EXECUTOR_PRIVATE_CONFIG, "utf8"))
const evidence = process.env.EXECUTOR_EVIDENCE
const runtime = process.versions.bun ? "bun" : "node"
const report = {
  runtime,
  version: process.versions.bun ?? process.version,
  startedAt: new Date().toISOString(),
  checks: [],
  hosted: "NotTested"
}
const url = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const admin = new Pool({
  ...cfg,
  host: "127.0.0.1",
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000
})
const schemas =
  runtime === "node" ? ["executor_node", "executor_workerd"] : ["executor_bun"]
let mf
try {
  report.serverVersion = (await admin.query("SHOW server_version")).rows[0].server_version
  assert.match(report.serverVersion, /^16\.15/)
  for (const schema of schemas) {
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.query(Jobs.migration(Jobs.tables({ schema })))
    await admin.query(Authority.proposal(schema))
    await admin.query(
      `ALTER TABLE "${schema}".sandboxes ADD COLUMN demo_owned boolean NOT NULL DEFAULT false`
    )
  }
  let alarmAt = null
  report.local = await Effect.runPromise(
    probe(
      url,
      `executor_${runtime}`,
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
        script: readFileSync("Worker.js", "utf8"),
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
        durableObjectsPersist: false,
        hyperdrives: { PG: url },
        outboundService: () => new Response("HTTP denied", { status: 403 })
      })
    )
    const response = await mf.dispatchFetch("https://probe.invalid/executor")
    report.workerd = await response.json()
    assert.equal(response.status, 200)
    assert.equal(report.workerd.status, "PASS")
    assert.equal(report.workerd.nativeAlarmSet, true)
  }
  report.status = "PASS"
} catch (error) {
  report.status = "FAIL"
  report.failureClass = error?.constructor?.name ?? "Unknown"
  report.frames = String(error?.stack ?? "")
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .map((line) => line.replace(/postgres[^ ]*/g, "[redacted]"))
  if (error?.code === "ERR_ASSERTION") {
    report.assertion = {
      actual: error.actual,
      expected: error.expected,
      operator: error.operator
    }
  }
  process.exitCode = 1
} finally {
  if (mf) {
    await mf.dispose()
  }
  report.remainingSessions = (
    await admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
    )
  ).rows[0].n
  if (report.remainingSessions !== 0) {
    report.status = "FAIL"
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
