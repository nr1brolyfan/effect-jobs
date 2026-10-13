// Foreground real PG/workerd/production browser slice; no HTTP fixture replacement.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"
import { chromium } from "@playwright/test"
import { createLocal } from "./Local.mjs"

const directory = process.env.D6_RESOURCE_DIRECTORY
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const pool = new Pool({ ...cfg, connectionTimeoutMillis: 2000, statement_timeout: 5000 })
const report = { checks: [], stage: "stored seed", success: false }
let local, browser
let safeFailure
try {
  process.env.REPAIR_PREPARE_ONLY = "true"
  const runtime = await import(`${directory}/RepairPg.mjs`)
  const { prepareRecorded } = runtime
  safeFailure = runtime.safeFailure
  const sandbox = await prepareRecorded()
  const query = async (sql, values = []) => (await pool.query(sql, values)).rows
  const [encrypted] = await query(
    `SELECT j.id FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.kind='playground.synthetic-document-export' AND j.state='Completed'`,
    [sandbox.ref.sandboxId]
  )
  assert.ok(encrypted)
  const [repair] = await query(
    `SELECT r.receipt FROM "${cfg.schema}".repair_receipts r WHERE r.sandbox_id=$1 AND r.request_id='synthetic-corrected-showcase-v1'`,
    [sandbox.ref.sandboxId]
  )
  assert.equal(repair.receipt.result._tag, "Committed")
  report.checks.push(
    "stored encrypted fixture and actual successful trusted repair receipt"
  )
  report.stage = "actual workerd PG admission"
  local = await createLocal(cfg, { https: false, localPrivate: true })
  for (const host of ["127.0.0.1", "localhost"]) {
    const origin = local.origin.replace("127.0.0.1", host)
    const base = `sandboxId=${sandbox.ref.sandboxId}&generation=${sandbox.ref.generation}`
    const response = await local.mf.dispatchFetch(
      `${origin}/api/demo/jobs/detail?${base}&jobId=${encrypted.id}`
    )
    assert.equal(response.status, 200)
    const detail = await response.json()
    assert.equal(detail.payload.encryption, "SyntheticDocumentV1")
    assert.equal(detail.job.state, "Completed")
    const [artifact] = await query(
      `SELECT payload FROM "${cfg.schema}".job_payloads WHERE job_id=$1`,
      [encrypted.id]
    )
    assert.deepEqual(
      detail.payload.encoded,
      JSON.parse(Buffer.from(artifact.payload).toString("utf8"))
    )
    assert.equal(
      (
        await local.mf.dispatchFetch(`${origin}/api/demo/jobs/repair`, {
          method: "POST",
          headers: { "X-Local-Private": "true" },
          body: "{}"
        })
      ).status,
      404
    )
  }
  report.checks.push(
    "actual stored payload byte identity on both aliases; public mutation refusal"
  )
  report.stage = "production browser stored decrypt and navigation"
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = []
  page.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() })
  )
  const errors = []
  page.on("pageerror", () => errors.push("pageerror"))
  for (const host of ["127.0.0.1", "localhost"]) {
    const origin = local.origin.replace("127.0.0.1", host)
    await page.goto(
      `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
    )
    await page.getByLabel("Synthetic unlock code").waitFor({ timeout: 15000 })
    await page.getByLabel("Synthetic unlock code").fill("wrong")
    await page.getByRole("button", { name: "Unlock locally" }).click()
    assert.equal(await page.getByLabel("Locally decrypted document").count(), 0)
    await page.getByLabel("Synthetic unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally" }).click()
    await page.getByLabel("Locally decrypted document").waitFor()
    await page.getByRole("button", { name: "Relock" }).click()
    assert.equal(await page.getByLabel("Locally decrypted document").count(), 0)
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0]
    )
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every((request) => request.method === "GET"))
  assert.ok(
    requests.every(
      (request) =>
        !request.url.includes("Synthetic%20encrypted") &&
        !request.url.includes(cfg.encryptionKey)
    )
  )
  report.checks.push(
    "production Client with real stored decrypt/wrong code/relock/no storage or key transmission, both aliases"
  )
  report.success = true
} catch (error) {
  report.failureClass = error instanceof Error ? error.name : "Unknown"
  report.sqlFailure = safeFailure?.(error)
  process.exitCode = 1
} finally {
  if (browser) {
    await browser.close()
  }
  if (local) {
    await local.mf.dispose()
  }
  await pool.end()
  report.servicesClosed = true
  writeFileSync(
    `${directory}/combined-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
