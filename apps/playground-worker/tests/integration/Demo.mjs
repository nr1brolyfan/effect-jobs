// Finite integration gate; RunOwned.py supplies ONLY its disposable PostgreSQL resource.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Pool } from "pg"
import { chromium } from "@playwright/test"
import { createLocal } from "./Local.mjs"
import { migrations } from "../../../../.multica/integration/Migrations.mjs"

const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({
  host: "127.0.0.1",
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database
})
let local
let browser
const until = async (test, timeout = 60000) => {
  const deadline = Date.now() + timeout
  while (!(await test())) {
    assert(Date.now() < deadline, "demo readiness/rotation timeout")
    await new Promise((done) => setTimeout(done, 250))
  }
}
try {
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of migrations(cfg.schema)) {
    await pool.query(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false, demoRotationMillis: 600000 })
  await local.mf.dispatchFetch(local.origin + "/demo")
  let initial
  await until(async () => {
    const response = await local.mf.dispatchFetch(local.origin + "/api/demo")
    if (!response.ok) {
      return false
    }
    initial = await response.json()
    return true
  })
  assert.equal(initial.capabilities.runScenario, false)
  assert.equal(initial.capabilities.resetSandbox, false)
  const states = await pool.query(
    `SELECT state,count(*)::int AS n FROM "${cfg.schema}".jobs GROUP BY state`
  )
  for (const state of ["Completed", "Dead", "Isolated", "RetryScheduled", "Pending"]) {
    assert(
      states.rows.some((row) => row.state === state && row.n >= 6),
      `seed missing ${state}`
    )
  }
  const list = await local.mf.dispatchFetch(
    local.origin +
      "/api/demo/jobs?" +
      new URLSearchParams({
        ...initial.ref,
        sandboxId: initial.ref.sandboxId,
        generation: String(initial.ref.generation),
        limit: "50"
      })
  )
  assert.equal(list.status, 200)
  const firstPage = await list.json()
  assert.equal(firstPage.items.length, 30)
  assert.equal(firstPage.stats.total, 30)
  const filtered = await local.mf.dispatchFetch(
    local.origin +
      "/api/demo/jobs?" +
      new URLSearchParams({
        sandboxId: initial.ref.sandboxId,
        generation: "1",
        limit: "1",
        state: "Dead"
      })
  )
  const filteredPage = await filtered.json()
  assert.equal(filteredPage.items.length, 1)
  assert.equal(filteredPage.stats.total, 30)
  assert.equal(filteredPage.stats.Dead, 6)
  const denied = await local.mf.dispatchFetch(local.origin + "/api/demo/scenarios", {
    method: "POST"
  })
  assert.equal(denied.status, 400)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  let signals = 0
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("websocket", (socket) => socket.on("framereceived", () => signals++))
  await page.goto(local.origin + "/demo")
  await page.locator('.connection-status[data-connection="connected"]').waitFor()
  assert.equal(await page.locator(".job-list tr").count(), 5)
  assert(
    await page.getByRole("button", { name: "Create jobs", exact: true }).isDisabled()
  )
  await until(
    async () =>
      (
        await pool.query(
          `SELECT retained_jobs FROM "${cfg.schema}".sandboxes WHERE sandbox_id=$1`,
          [initial.ref.sandboxId]
        )
      ).rows[0].retained_jobs > 30
  )
  assert(signals > 0, "no live websocket signals")
  // Accelerate the persisted rotation deadline; the production default remains 24h.
  await pool.query(`UPDATE "${cfg.schema}".demo_control SET rotate_at=0`)
  // Preserve a private sandbox marker and check cleanup never touches it.
  const privateId = "private-retention-marker"
  await pool.query(
    `INSERT INTO "${cfg.schema}".sandboxes(sandbox_id,generation,expires_at,credential_hash) VALUES($1,1,$2,$3)`,
    [privateId, Date.now() + 600000, "private-marker"]
  )
  let next
  const snapshots = []
  await until(async () => {
    const response = await local.mf.dispatchFetch(local.origin + "/api/demo")
    assert.equal(response.status, 200, "rotation exposed unavailable/empty demo")
    next = await response.json()
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM "${cfg.schema}".associations WHERE sandbox_id=$1`,
      [next.ref.sandboxId]
    )
    snapshots.push(rows[0].n)
    assert(rows[0].n >= 30, "rotation exposed partial seed")
    return next.ref.sandboxId !== initial.ref.sandboxId
  })
  await until(async () =>
    (await page.locator(".sandbox-scope").textContent()).includes(next.ref.sandboxId)
  )
  await page.locator('.connection-status[data-connection="connected"]').waitFor()
  assert.equal(await page.locator(".job-list tr").count(), 5)
  assert.deepEqual(errors, [])
  // The retired Pending/retry jobs must finish, not be silently deleted.
  await until(
    async () =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "${cfg.schema}".sandboxes WHERE sandbox_id=$1`,
          [initial.ref.sandboxId]
        )
      ).rows[0].n === 0,
    180000
  )
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM "${cfg.schema}".sandboxes WHERE sandbox_id=$1`,
        [privateId]
      )
    ).rows[0].n,
    1
  )
  assert(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM "${cfg.schema}".sandboxes WHERE demo_owned`
      )
    ).rows[0].n <= 2
  )
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "real seeded lifecycle across six workloads",
        "read-only demo",
        "alarm generates new jobs",
        "live websocket updates",
        "atomic nonempty rotation",
        "browser follows new generation",
        "retired jobs drain before cleanup",
        "private sandbox untouched",
        "bounded generation count"
      ],
      minimumPublishedJobs: Math.min(...snapshots)
    })
  )
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
}
