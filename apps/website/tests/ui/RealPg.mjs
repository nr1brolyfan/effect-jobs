// Finite real PostgreSQL + production workerd/Client/Chromium qualification FFI.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { Effect } from "effect"
import * as Crypto from "../../../../packages/playground-contracts/dist/SyntheticCryptoFixture.js"
import { createLocal } from "../../../playground-worker/tests/integration/Local.mjs"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { Pool } = require("pg")
const { chromium, expect } = require("@playwright/test")
const evidence = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const pool = new Pool({
  host: "127.0.0.1",
  ...cfg,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const checks = [],
  errors = [],
  requests = [],
  logs = []
let local,
  browser,
  stage = "migrations"
try {
  assert.match(
    (await pool.query("SHOW server_version")).rows[0].server_version,
    /^16\.15/
  )
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of migrations(cfg.schema)) {
    await pool.query(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false, localPrivate: true })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"]
  })
  const page = await context.newPage()
  page.on("pageerror", () => errors.push("pageerror"))
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? "" })
  )
  page.on("console", (m) => logs.push(m.text()))
  stage = "private admission and stored encrypted payload"
  await page.goto(local.origin + "/jobs")
  await expect(page.locator("button[data-job-id]").first()).toBeVisible({
    timeout: 30000
  })
  const rows = (
    await pool.query(
      `SELECT j.id, p.payload FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".job_payloads p ON p.job_id=j.id WHERE j.kind='playground.synthetic-document-export'`
    )
  ).rows
  assert(rows.length > 0, "private issuance must persist a synthetic encrypted starter")
  const job = rows[0]
  const encoded = JSON.parse(Buffer.from(job.payload).toString("utf8"))
  const document = await Effect.runPromise(Crypto.openSyntheticDocument(encoded.document))
  await page.getByRole("button", { name: job.id, exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  const code = page.getByLabel("Demo unlock code", { exact: true })
  const readable = page.getByLabel("Readable payload", { exact: true })
  await code.fill("wrong")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Job payload" }).getByRole("status")
  ).toContainText("authentication failed")
  await expect(readable).toHaveCount(0)
  const beforeUnlock = requests.length
  await code.fill("123")
  await code.press("Enter")
  await expect(readable).toContainText(document.note)
  assert.deepEqual(JSON.parse(await readable.innerText()), { ...encoded, document })
  await expect(code).toHaveValue("")
  await page.getByRole("button", { name: "Copy payload", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Job payload" }).getByRole("status")
  ).toHaveText("Payload copied.")
  assert.deepEqual(
    JSON.parse(await page.evaluate(() => navigator.clipboard.readText())),
    { ...encoded, document }
  )
  assert(!requests.slice(beforeUnlock).some((r) => r.method === "POST"))
  assert(!requests.some((r) => (r.url + r.body).includes(document.note)))
  assert(!logs.some((text) => text.includes(document.note)))
  assert.deepEqual(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    [0, 0]
  )
  checks.push(
    "PG persisted envelope equals complete locally authenticated/copied payload; wrong code, empty code, no mutation/plaintext transmission/log/storage"
  )
  stage = "drawer full page relock and focus"
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: job.id, exact: true })).toBeFocused()
  await page.getByRole("button", { name: job.id, exact: true }).click()
  await expect(readable).toHaveCount(0)
  await page.getByRole("button", { name: "Open full details", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Job details", exact: true })
  ).toBeFocused()
  await expect(readable).toHaveCount(0)
  await code.fill("123")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(readable).toContainText(document.note)
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await expect(readable).toHaveCount(0)
  await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
  await expect(page.getByRole("button", { name: job.id, exact: true })).toBeFocused()
  checks.push(
    "Escape/close and fullpage/back reset volatile plaintext and restore actual opener/heading focus"
  )
  stage = "real live disconnect and recovery"
  await context.setOffline(true)
  await expect(page.locator(".connection-status")).toContainText(/reconnecting|stale/)
  await context.setOffline(false)
  await expect(page.locator(".connection-status")).toHaveText("connected", {
    timeout: 15000
  })
  await expect(page.getByRole("button", { name: job.id, exact: true })).toBeVisible()
  checks.push(
    "actual workerd WebSocket disconnect/reconnect restores connected authoritative reads"
  )
  stage = "public demo private boundary and read-only mutation rejection"
  await page.goto(local.origin + "/demo")
  await expect(page.locator("button[data-job-id]").first()).toBeVisible({
    timeout: 45000
  })
  const publicStart = requests.length
  const publicJob = page.locator("button[data-job-id]").first()
  await publicJob.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  const denied = await context.request.post(local.origin + "/api/demo/scenarios", {
    data: {},
    headers: { Origin: local.origin }
  })
  assert.equal(denied.status(), 404)
  assert(
    !requests
      .slice(publicStart)
      .some(
        (r) =>
          new URL(r.url).pathname.startsWith("/api/") &&
          !new URL(r.url).pathname.startsWith("/api/demo")
      )
  )
  assert.deepEqual(errors, [])
  checks.push(
    "real public demo renders/details/close; mutation rejected; no private API reads from demo"
  )
  writeFileSync(
    `${evidence}/runtime-result.json`,
    JSON.stringify({ status: "PASS", checks, browser: browser.version() }, null, 2)
  )
} catch (error) {
  writeFileSync(
    `${evidence}/runtime-result.json`,
    JSON.stringify(
      {
        status: "FAIL",
        stage,
        checks,
        error: String(error).replaceAll(cfg.password, "[redacted]")
      },
      null,
      2
    )
  )
  throw new Error("Website runtime gate failed at " + stage)
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
}
