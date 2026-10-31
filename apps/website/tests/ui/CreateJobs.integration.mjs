// Browser/native-resource FFI: production bundle, real workerd/PG, disposable synthetic data.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { createLocal } from "../../../playground-worker/tests/integration/Local.mjs"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const { Pool } = require("pg")
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const output = ".multica/create-jobs/real"
const { migrations } = await import(resolve(output, "Migrations.mjs"))
const pool = new Pool({
  host: "127.0.0.1",
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const count = async () =>
  Number((await pool.query(`SELECT count(*) AS n FROM "${cfg.schema}".jobs`)).rows[0].n)
let mf, browser
const errors = [],
  checks = [],
  writes = []
try {
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of migrations(cfg.schema)) {
    await pool.query(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  const local = await createLocal(cfg, { https: false, localPrivate: true })
  mf = local.mf
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /api\/(scenarios|sandbox\/reset)$/.test(new URL(r.url()).pathname)
    ) {
      writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() })
    }
  })
  await page.goto(local.origin + "/jobs")
  await expect(page.locator(".results-count")).toContainText("results")
  const before = await count()
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await expect(page.getByLabel("Fake provider behavior")).toBeFocused()
  await page.getByLabel("Jobs (1–10)").fill("2")
  await page.getByRole("button", { name: "Run scenario", exact: true }).evaluate((n) => {
    n.click()
    n.click()
  })
  await expect(
    page.getByRole("status").filter({ hasText: "Enqueue acknowledged for 2" })
  ).toBeVisible()
  assert.equal(await count(), before + 2)
  assert.equal(writes.length, 1)
  await page.getByLabel("Fake provider behavior").selectOption("delayed-success")
  await page.getByLabel("Jobs (1–10)").fill("1")
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Enqueue acknowledged for 1" })
  ).toBeVisible()
  assert.equal(await count(), before + 3)
  assert.equal(writes.length, 2)
  checks.push(
    "real scenario POST: success batch2, delayed-success batch1; PG count +3; duplicate click single request"
  )
  await page.screenshot({ path: output + "/desktop-dialog.png", fullPage: true })
  await page.locator("summary").click()
  const resetCount = await count()
  page.once("dialog", (d) => d.dismiss())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  assert.equal(await count(), resetCount)
  page.once("dialog", (d) => d.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await expect(page.locator(".sandbox-scope")).toContainText("generation 2")
  await expect(page.getByLabel("Fake provider behavior")).toHaveValue("success")
  await expect(page.getByLabel("Jobs (1–10)")).toHaveValue("1")
  await expect
    .poll(() =>
      page
        .getByRole("dialog", { name: "Create jobs", exact: true })
        .evaluate((n) => n.contains(document.activeElement))
    )
    .toBe(true)
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeEnabled()
  assert.equal(writes.filter((w) => w.path.endsWith("/reset")).length, 1)
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Enqueue acknowledged for 1" })
  ).toBeVisible()
  assert.equal(writes.at(-1).body.sandbox.generation, 2)
  checks.push(
    "real reset cancellation/confirmation, generation2 fresh controls and generation2 create"
  )
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("button", { name: "Create jobs", exact: true })
  ).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await expect(page.getByLabel("Fake provider behavior")).toBeFocused()
  await page.screenshot({ path: output + "/mobile-dialog.png", fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.keyboard.press("Escape")
  await page.screenshot({ path: output + "/mobile-dashboard.png", fullPage: true })
  const demo = await browser.newPage()
  await demo.goto(local.origin + "/demo")
  await expect(demo.locator(".job-list tr").first()).toBeVisible({ timeout: 60000 })
  await expect(
    demo.getByRole("button", { name: "Create jobs", exact: true })
  ).toHaveCount(0)
  checks.push("real public demo read only; mobile layout and focus")
  assert.deepEqual(errors, [])
  writeFileSync(
    output + "/receipt.json",
    JSON.stringify(
      {
        result: "PASS",
        checks,
        errors,
        writes,
        browser: browser.version(),
        node: process.version,
        postgres: (await pool.query("SHOW server_version")).rows[0].server_version,
        hashes: Object.fromEntries(
          [
            "apps/website/dist/Client.js",
            "apps/website/dist/Jobs.css",
            "apps/playground-worker/dist/Worker.js"
          ].map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])
        )
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ result: "PASS", checks }))
} finally {
  await browser?.close()
  await mf?.dispose()
  await pool.end()
}
