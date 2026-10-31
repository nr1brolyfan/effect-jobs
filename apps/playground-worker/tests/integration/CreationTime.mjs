// Real PG + production workerd + browser. Only fresh config from RunOwned.py.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { defaultPolicy } from "effect-jobs/JobPolicy"
import { createLocal } from "./Local.mjs"

const out = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const { migrations } = await import(`${out}/Migrations.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({
  host: "127.0.0.1",
  ...cfg,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const report = { checks: [], success: false, snapshots: [] }
let browser, local
const table = (name) => `"${cfg.schema}"."${name}"`
try {
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  const descriptors = migrations(cfg.schema)
  for (const migration of descriptors.slice(0, -1)) {
    await pool.query(migration.sql)
  }
  assert.equal(descriptors.at(-1).id, "playground-job-creation-time-v7")
  await pool.query(
    `INSERT INTO ${table("jobs")}(id,operation,operation_id,slot,queue,kind,version,policy,state,available_at,updated_at)
    VALUES ('legacy-created-unknown','legacy','legacy','job','legacy','legacy',1,$1,'Pending',253402300799999,123)`,
    [defaultPolicy]
  )
  await pool.query(descriptors.at(-1).sql)
  assert.equal(
    (
      await pool.query(
        `SELECT created_at FROM ${table("jobs")} WHERE id='legacy-created-unknown'`
      )
    ).rows[0].created_at,
    null
  )
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false, localPrivate: true })
  assert.notEqual(new URL(local.origin).port, "8787")
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    timezoneId: "Europe/Warsaw",
    viewport: { width: 1400, height: 1000 }
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  const inspect = async (prefix) => {
    await page.goto(local.origin + prefix)
    await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible({
      timeout: 60000
    })
    const opener = page.locator("button[data-job-id]").first()
    await expect(opener).toBeVisible()
    const id = await opener.getAttribute("data-job-id")
    const row = (
      await pool.query(`SELECT created_at FROM ${table("jobs")} WHERE id=$1`, [id])
    ).rows[0]
    assert.ok(Number(row.created_at) > 0)
    const iso = new Date(Number(row.created_at)).toISOString()
    await opener.click()
    const drawer = page.getByRole("dialog", { name: "Quick job details" })
    const created = drawer.getByRole("button", { name: /^Creation time:/ })
    await expect(created.locator("time")).toHaveAttribute("datetime", iso)
    await created.click()
    await expect(page.getByText("Local · Europe/Warsaw", { exact: true })).toBeVisible()
    await expect(page.getByText("UTC", { exact: true })).toBeVisible()
    await expect(page.getByText(iso, { exact: true })).toBeVisible()
    await page.screenshot({
      animations: "disabled",
      path: `${out}/${prefix.slice(1)}-creation-local-utc.png`
    })
    await page.keyboard.press("Escape")
    await drawer.getByRole("button", { name: "Open full details", exact: true }).click()
    const full = page.getByRole("main", { name: "Job details" })
    await expect(
      full.getByRole("button", { name: /^Creation time:/ }).locator("time")
    ).toHaveAttribute("datetime", iso)
    await page.screenshot({
      animations: "disabled",
      path: `${out}/${prefix.slice(1)}-creation-full.png`
    })
    report.snapshots.push({
      mode: prefix,
      jobId: id,
      createdAt: Number(row.created_at),
      iso
    })
    report.checks.push(
      `${prefix}: actual durable Created in drawer/full page; exact local/UTC popover`
    )
  }
  await inspect("/jobs")
  const csrf = (await context.cookies()).find((cookie) =>
    cookie.name.includes("csrf")
  ).value
  const response = await context.request.post(local.origin + "/api/sandbox", {
    headers: {
      Origin: local.origin,
      "X-Playground-CSRF": csrf,
      "Content-Type": "application/json"
    }
  })
  assert.equal(response.status(), 200)
  const sandbox = (await response.json()).ref
  await pool.query(
    `INSERT INTO ${table("associations")}(sandbox_id,generation,job_id,relations) VALUES ($1,$2,'legacy-created-unknown','{}')`,
    [sandbox.sandboxId, sandbox.generation]
  )
  await page.goto(
    `${local.origin}/jobs/legacy-created-unknown?generation=${sandbox.generation}`
  )
  const full = page.getByRole("main", { name: "Job details" })
  await expect(full.getByLabel("Creation time not recorded", { exact: true })).toHaveText(
    "—"
  )
  await expect(full.getByRole("button", { name: /^Creation time:/ })).toHaveCount(0)
  await page.screenshot({
    animations: "disabled",
    path: `${out}/legacy-creation-unknown.png`
  })
  report.checks.push(
    "populated pre-v7 legacy row: null, accessible unknown dash and no invented time"
  )
  await inspect("/demo")
  const demo = await (await context.request.get(local.origin + "/api/demo")).json()
  assert.equal(demo.capabilities.runScenario, false)
  assert.equal(demo.capabilities.resetSandbox, false)
  const denied = await context.request.post(local.origin + "/api/demo/scenarios", {
    data: {}
  })
  assert.notEqual(denied.status(), 200)
  report.checks.push("demo remains read only")
  assert.deepEqual(errors, [])
  report.success = true
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
  writeFileSync(`${out}/browser-receipt.json`, JSON.stringify(report, null, 2) + "\n")
}
