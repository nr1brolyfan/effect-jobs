// Affected final Harness section only: real PG and local workerd authority/alarm assertions.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "pg"
import { createLocal } from "./Local.mjs"
const root = resolve(import.meta.dirname, "../../../..")
const evidence = resolve(root, ".multica/integration")
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({
  host: "127.0.0.1",
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const schema = cfg.schema
const report = {
  at: new Date().toISOString(),
  checks: [],
  observations: {},
  hosted: "NotTested",
  runtime: process.version
}
const sql = async (text, values = []) => (await pool.query(text, values)).rows
const check = (name) => report.checks.push({ name, at: new Date().toISOString() })
const until = async (test, label, budget = 15000) => {
  const deadline = Date.now() + budget
  for (;;) {
    if (await test()) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(label)
    }
    await new Promise((done) => setTimeout(done, 250))
  }
}
let mf, local
try {
  assert.match((await sql("SHOW server_version"))[0].server_version, /^16\.15/)
  await sql("CREATE EXTENSION pg_stat_statements")
  await sql(`CREATE SCHEMA "${schema}"`)
  for (const migration of migrations(schema)) {
    await sql(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { instrument: true })
  mf = local.mf
  const dispatch = (path, options = {}) => mf.dispatchFetch(local.origin + path, options)
  const post = (path, cookie, token, body) =>
    dispatch(path, {
      method: "POST",
      headers: {
        Origin: local.origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie, "X-Playground-CSRF": token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const issue = async () => {
    const response = await post("/api/sandbox/issue")
    assert.equal(response.status, 200)
    const cookies = response.headers.getSetCookie()
    assert(
      cookies.some(
        (value) =>
          value.includes("HttpOnly") &&
          value.includes("Secure") &&
          value.includes("SameSite=Strict")
      )
    )
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ")
    const token = cookies
      .find((value) => value.startsWith("__Host-playground-csrf="))
      .split(";")[0]
      .split("=")[1]
    return { sandbox: await response.json(), cookie, token }
  }
  const b = await issue()
  const describe = (who) => post("/api/sandbox", who.cookie, who.token)
  const query = (who) =>
    `/api/jobs?sandboxId=${who.sandbox.ref.sandboxId}&generation=${who.sandbox.ref.generation}&limit=5`
  // One authorized viewer keeps all four shared queues alive; zero viewers retires all.
  await sql(`UPDATE "${schema}".sandboxes SET viewer_until=1`)
  await describe(b)
  const alive = await (await dispatch("/_integration/queues")).json()
  assert(alive.every((queue) => queue.alarm !== null))
  await sql(`UPDATE "${schema}".sandboxes SET viewer_until=1`)
  await until(
    async () =>
      (await (await dispatch("/_integration/queues")).json()).every(
        (queue) => queue.alarm === null
      ),
    "all shared queues did not retire",
    8000
  )
  const authorityBefore = await sql(
    `SELECT sandbox_id,generation,retained_jobs,next_generation_at FROM "${schema}".sandboxes ORDER BY sandbox_id`
  )
  const rowsBefore = await sql(
    `SELECT count(*)::int AS jobs, coalesce(sum(lifecycle_version),0)::text AS versions FROM "${schema}".jobs`
  )
  await new Promise((done) => setTimeout(done, 600))
  const rowsAfter = await sql(
    `SELECT count(*)::int AS jobs, coalesce(sum(lifecycle_version),0)::text AS versions FROM "${schema}".jobs`
  )
  assert.deepEqual(rowsAfter, rowsBefore)
  const authorityAfter = await sql(
    `SELECT sandbox_id,generation,retained_jobs,next_generation_at FROM "${schema}".sandboxes ORDER BY sandbox_id`
  )
  assert.deepEqual(authorityAfter, authorityBefore)
  const retired = await (await dispatch("/_integration/queues")).json()
  assert(retired.every((queue, i) => queue.calls > alive[i].calls))
  report.observations.retired = retired
  report.observations.noGenerationOrDrain = true
  await describe(b)
  const resumed = await (await dispatch("/_integration/queues")).json()
  assert(resumed.every((queue) => queue.alarm !== null))
  assert(resumed.every((queue, i) => queue.activations > retired[i].activations))
  report.observations.resumed = resumed
  await sql(`UPDATE "${schema}".sandboxes SET expires_at=1 WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  assert.equal((await describe(b)).status, 401)
  assert.equal((await dispatch(query(b), { headers: { Cookie: b.cookie } })).status, 401)
  check(
    "global last-viewer retirement / describe resumes ALL four queues / DB-time expiry"
  )
  report.status = "PASS"
} catch (error) {
  report.status = "FAIL"
  report.failureClass = error.constructor.name
  if (error.code === "ERR_ASSERTION") {
    report.assertion = {
      actual: error.actual,
      expected: error.expected,
      operator: error.operator
    }
  }
  report.frames = String(error.stack ?? "")
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .map((line) => line.replace(/postgres[^ ]*/g, "[redacted]"))
  process.exitCode = 1
} finally {
  if (mf) {
    await mf.dispose()
  }
  report.remainingSessions = (
    await sql(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
    )
  )[0].n
  if (report.remainingSessions !== 0) {
    report.status = "FAIL"
    process.exitCode = 1
  }
  await pool.end()
  report.finishedAt = new Date().toISOString()
  writeFileSync(
    `${root}/.multica/a1/runtime/integrated-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
