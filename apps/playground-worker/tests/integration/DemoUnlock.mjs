// Finite real-PG/workerd/browser reproduction. Only fresh run-owned configuration.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { pathToFileURL } from "node:url"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { Effect } from "effect"
import * as Fixture from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import { createLocal } from "./Local.mjs"

const directory = process.env.D6_RESOURCE_DIRECTORY
const configPath = process.env.PLAYGROUND_PRIVATE_CONFIG
const original = readFileSync(configPath, "utf8")
const cfg = JSON.parse(original)
cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const pool = new Pool({ ...cfg, connectionTimeoutMillis: 2000, statement_timeout: 5000 })
const report = { checks: [], stage: "baseline", success: false }
let browser, local, publicLocal, baseline
const query = async (sql, values = []) => (await pool.query(sql, values)).rows
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const postFor = async (context, origin) => {
  const token = (await context.cookies()).find((cookie) =>
    cookie.name.includes("csrf")
  ).value
  return async (path, body) => {
    const response = await context.request.post(origin + path, {
      headers: {
        Origin: origin,
        "X-Playground-CSRF": token,
        "Content-Type": "application/json"
      },
      data: body
    })
    assert.equal(response.status(), 200)
    return response.json()
  }
}
try {
  browser = await chromium.launch({ headless: true })
  process.env.REPAIR_PREPARE_ONLY = "true"
  // Baseline root is explicit; never read its private preview configuration.
  const baselineRoot = process.env.DEMO_UNLOCK_BASELINE_ROOT
  assert.ok(baselineRoot)
  if (process.env.DEMO_UNLOCK_BASELINE_RECEIPT) {
    const prior = JSON.parse(
      readFileSync(process.env.DEMO_UNLOCK_BASELINE_RECEIPT, "utf8")
    )
    assert.equal(prior.baseline.twoHexFieldsAnd123Rejected, true)
    assert.equal(
      prior.baseline.workerSha256,
      hash(readFileSync(`${baselineRoot}/apps/playground-worker/dist/Worker.js`))
    )
    assert.equal(
      prior.baseline.clientSha256,
      hash(readFileSync(`${baselineRoot}/apps/website/dist/Client.js`))
    )
    report.baseline = prior.baseline
    report.checks.push(
      "consumed completed baseline reproduction with unchanged artifact hashes"
    )
  } else {
    const oldCfg = { ...cfg, schema: "unlock_baseline" }
    writeFileSync(configPath, JSON.stringify(oldCfg))
    const old = await import(`${directory}/BaselinePg.mjs`)
    await old.prepareRecorded()
    const oldLocal = await import(
      pathToFileURL(`${baselineRoot}/apps/playground-worker/tests/integration/Local.mjs`)
    )
    baseline = await oldLocal.createLocal(oldCfg, { https: false, localPrivate: true })
    const oldContext = await browser.newContext()
    const oldPage = await oldContext.newPage()
    await oldPage.goto(baseline.origin + "/jobs")
    await expect(oldPage.getByRole("table", { name: "Background jobs" })).toBeVisible()
    const oldPost = await postFor(oldContext, baseline.origin)
    const oldRef = (await oldPost("/api/sandbox")).ref
    const [oldJob] = await query(
      `SELECT j.id FROM "unlock_baseline".jobs j JOIN "unlock_baseline".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.kind='playground.private-data-export'`,
      [oldRef.sandboxId]
    )
    assert.ok(oldJob)
    await oldPage.goto(
      `${baseline.origin}/jobs/${oldJob.id}?generation=${oldRef.generation}`
    )
    await expect(oldPage.getByLabel("Local encryption key (hex)")).toBeVisible()
    await expect(oldPage.getByLabel("Local fingerprint key (hex)")).toBeVisible()
    await oldPage.getByLabel("Local encryption key (hex)").fill("123")
    await oldPage.getByLabel("Local fingerprint key (hex)").fill("123")
    await oldPage.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(
      oldPage.getByRole("status").filter({ hasText: "authentication failed" })
    ).toBeVisible()
    await expect(oldPage.getByLabel("Locally decrypted document")).toHaveCount(0)
    report.baseline = {
      head: "a5e7522e54a323c4342cd790c744ad89d7917c19",
      workerSha256: hash(
        readFileSync(`${baselineRoot}/apps/playground-worker/dist/Worker.js`)
      ),
      clientSha256: hash(readFileSync(`${baselineRoot}/apps/website/dist/Client.js`)),
      twoHexFieldsAnd123Rejected: true
    }
    report.checks.push(
      "original complaint reproduced on stored initial private job in baseline browser"
    )
    await oldContext.close()
    await baseline.mf.dispose()
    baseline = null
    writeFileSync(configPath, original)
  }

  report.stage = "final stored seed and executor"
  const runtime = await import(`${directory}/RepairPg.mjs`)
  const demo = await runtime.prepareRecorded()
  local = await createLocal(cfg, { https: false, localPrivate: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = [],
    transmissions = [],
    logs = []
  page.on("pageerror", () => errors.push("pageerror"))
  page.on("console", (message) => logs.push(message.text()))
  page.on("request", (request) =>
    transmissions.push(request.url() + (request.postData() ?? ""))
  )
  await page.goto(local.origin + "/jobs")
  await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
  const post = await postFor(context, local.origin)
  const ref = (await post("/api/sandbox")).ref
  const encryptedJobs = async (sandbox) =>
    query(
      `SELECT j.id,j.state,j.operation,p.payload FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id JOIN "${cfg.schema}".job_payloads p ON p.job_id=j.id WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.kind='playground.synthetic-document-export' ORDER BY j.id`,
      [sandbox.sandboxId, sandbox.generation]
    )
  const [starter] = await encryptedJobs(ref)
  assert.ok(starter)
  await post("/api/scenarios", {
    sandbox: ref,
    requestId: crypto.randomUUID(),
    scenario: "success",
    count: 6
  })
  const fresh = (await encryptedJobs(ref)).find((job) => job.id !== starter.id)
  assert.ok(fresh)
  await runtime.drainRecorded()
  await runtime.drainRecorded()
  const publicJobs = await encryptedJobs(demo.ref)
  assert.ok(publicJobs.some((job) => job.state === "Completed"))
  const inspect = async (prefix, sandbox, job, host = "127.0.0.1") => {
    report.stage = `${prefix} stored unlock (${host})`
    const origin = local.origin.replace("127.0.0.1", host)
    const encoded = JSON.parse(Buffer.from(job.payload).toString("utf8"))
    const expected = await Effect.runPromise(
      Fixture.openSyntheticDocument(encoded.document)
    )
    const response = await context.request.get(
      `${origin}/api/${prefix === "demo" ? "demo/" : ""}jobs/detail?sandboxId=${sandbox.sandboxId}&generation=${sandbox.generation}&jobId=${job.id}`
    )
    assert.equal(response.status(), 200)
    const detail = await response.json()
    assert.ok(isDeepStrictEqual(detail.payload.encoded, encoded))
    assert.equal(detail.payload.encryption, "SyntheticDocumentV1")
    assert.equal(detail.eligibility.correctedRedrive.enabled, false)
    if (["Dead", "Isolated"].includes(detail.job.state)) {
      assert.equal(
        detail.eligibility.correctedRedrive.reason,
        "encrypted-correction-unavailable"
      )
    }
    await page.goto(
      `${origin}/${prefix === "demo" ? "demo/jobs" : "jobs"}/${job.id}?generation=${sandbox.generation}`
    )
    await expect(page.getByLabel("Demo unlock code")).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(1)
    await expect(page.getByLabel("Encoded payload")).toBeHidden()
    await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
    const beforeUnlock = transmissions.length
    await page.getByLabel("Demo unlock code").fill("wrong")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(
      page.getByRole("status").filter({ hasText: "Use demo code 123" })
    ).toBeVisible()
    await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    const plain = page.getByLabel("Locally decrypted document")
    await expect(plain).toBeVisible()
    assert.ok(isDeepStrictEqual(JSON.parse(await plain.innerText()), expected))
    await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
    // Live reads may happen; unlock never introduces a mutation, key or plaintext.
    assert.ok(
      transmissions
        .slice(beforeUnlock)
        .every(
          (entry) =>
            !entry.includes(expected.note) &&
            !entry.includes(cfg.encryptionKey) &&
            !entry.includes(cfg.fingerprintKey)
        )
    )
    await page.getByText("Show encoded payload", { exact: true }).click()
    await expect(page.getByLabel("Encoded payload")).toBeVisible()
    await page.getByRole("button", { name: "Relock", exact: true }).click()
    await expect(plain).toHaveCount(0)
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(plain).toBeVisible()
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
    await expect(plain).toHaveCount(0)
    await page.getByLabel("Kind (exact)").fill(Fixture.syntheticDocumentCatalog.kind)
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await page.getByRole("button", { name: job.id, exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
    await expect(plain).toHaveCount(0)
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(plain).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("button", { name: job.id, exact: true }).click()
    await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
    await expect(plain).toHaveCount(0)
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0]
    )
    assert.ok(
      logs.every(
        (entry) =>
          !entry.includes(expected.note) &&
          !entry.includes(cfg.encryptionKey) &&
          !entry.includes(cfg.fingerprintKey)
      )
    )
    report.checks.push(
      `${prefix}/${host}: actual persisted bytes = HTTP envelope = locally authenticated plaintext; one code field; wrong code; encoded disclosure; close/navigation relock; no storage/log/transmission`
    )
  }
  await inspect("jobs", ref, starter)
  await inspect("jobs", ref, fresh)
  await inspect(
    "demo",
    demo.ref,
    publicJobs.find(
      (job) => job.state === "Completed" && job.operation === "playground.synthetic"
    )
  )
  // Localhost has its own admission/cookie; public read-only sample needs none.
  await inspect(
    "demo",
    demo.ref,
    publicJobs.find(
      (job) => job.state === "Completed" && job.operation === "playground.synthetic"
    ),
    "localhost"
  )
  await inspect(
    "demo",
    demo.ref,
    publicJobs.find((job) => job.operation === "playground.synthetic-showcase")
  )
  report.stage = "encrypted private plain redrive"
  const before = await context.request.get(
    `${local.origin}/api/jobs/detail?sandboxId=${ref.sandboxId}&generation=${ref.generation}&jobId=${starter.id}`
  )
  const source = await before.json()
  assert.equal(source.job.state, "Dead")
  const repaired = await post("/api/jobs/repair", {
    sandbox: ref,
    requestId: crypto.randomUUID(),
    jobId: starter.id,
    expectedState: source.job.state,
    expectedLifecycleVersion: source.job.lifecycleVersion,
    expectedResolutionVersion: source.problem?.version ?? 0,
    action: "redrive",
    reason: "Synthetic encrypted immutable redrive qualification",
    confirmDuplicateEffects: true,
    investigation: { _tag: "KnownFailure" }
  })
  assert.equal(repaired._tag, "Committed")
  await runtime.drainRecorded()
  await runtime.drainRecorded()
  const [unchanged] = await query(
    `SELECT payload FROM "${cfg.schema}".job_payloads WHERE job_id=$1`,
    [starter.id]
  )
  assert.ok(Buffer.from(unchanged.payload).equals(Buffer.from(starter.payload)))
  const [successor] = await query(
    `SELECT j.state,p.payload FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".job_payloads p ON p.job_id=j.id WHERE j.id=$1`,
    [repaired.resultJobId]
  )
  assert.equal(successor.state, "Dead")
  const successorDocument = await Effect.runPromise(
    Fixture.openSyntheticDocument(
      JSON.parse(Buffer.from(successor.payload).toString("utf8")).document
    )
  )
  const sourceDocument = await Effect.runPromise(
    Fixture.openSyntheticDocument(
      JSON.parse(Buffer.from(starter.payload).toString("utf8")).document
    )
  )
  assert.ok(isDeepStrictEqual(sourceDocument, successorDocument))
  report.checks.push(
    "real encrypted plain redrive preserves source bytes and decrypted fields; original terminal behavior retained; public trusted unencrypted correction/reconciliation remains qualified by seed"
  )
  report.stage = "private/public authority"
  const foreign = await context.request.get(
    `${local.origin}/api/jobs/detail?sandboxId=${ref.sandboxId}&generation=${ref.generation}&jobId=${publicJobs[0].id}`
  )
  assert.equal(foreign.status(), 404)
  publicLocal = await createLocal(cfg, { https: false, localPrivate: false })
  for (const path of [
    "/api/sandbox/issue",
    "/api/jobs/repair",
    "/api/jobs/resolution",
    "/api/demo/jobs/repair"
  ]) {
    const response = await publicLocal.mf.dispatchFetch(publicLocal.origin + path, {
      method: "POST",
      headers: { "X-Local-Private": "true" },
      body: "{}"
    })
    assert.equal(response.status, 404)
  }
  assert.deepEqual(errors, [])
  report.checks.push(
    "public read-only and spoofed private mutation refusal; cross-sandbox detail refusal; real executor completed synthetic export; encrypted correction disabled"
  )
  report.runtime = { chromium: browser.version() }
  report.success = true
} catch (error) {
  report.failureClass = error instanceof Error ? error.name : "Unknown"
  report.site =
    error instanceof Error
      ? error.stack?.match(/DemoUnlock\.mjs:\d+:\d+/)?.[0]
      : undefined
  process.exitCode = 1
} finally {
  writeFileSync(configPath, original)
  if (browser) {
    await browser.close()
  }
  for (const runtime of [baseline, local, publicLocal]) {
    if (runtime) {
      await runtime.mf.dispose()
    }
  }
  await pool.end()
  writeFileSync(
    `${directory}/demo-unlock-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
