// Real production UI + workerd + PG qualification; all resources closed foreground.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"

const directory = process.env.D6_RESOURCE_DIRECTORY
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
cfg.localPrivate = true
const pool = new Pool({ ...cfg, connectionTimeoutMillis: 2000, statement_timeout: 5000 })
const report = { success: false, stage: "setup", checks: [], cases: [] }
let local, browser
try {
  process.env.REPAIR_PREPARE_ONLY = "true"
  const runtime = await import(`${directory}/SyntheticCorrection.mjs`)
  const recorded = await runtime.prepareRecorded()
  const query = async (sql, values = []) => (await pool.query(sql, values)).rows
  const [version] = await query("SHOW server_version")
  assert.match(version.server_version, /^16\.15/)
  report.postgresql = version.server_version
  local = await createLocal(cfg, { https: false, localPrivate: true })
  const origin = local.origin
  browser = await chromium.launch({ headless: true })
  report.chromium = browser.version()
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"]
  })
  // Delay only completion of genuine native encryption to reproduce cancellation.
  await context.addInitScript(() => {
    // Retain dynamic this when calling the native method below.
    // oxlint-disable-next-line typescript/unbound-method
    const encrypt = SubtleCrypto.prototype.encrypt
    SubtleCrypto.prototype.encrypt = async function (...args) {
      const result = await encrypt.apply(this, args)
      if (window.__holdSeal) {
        await new Promise((resolve) => {
          window.__releaseSeal = resolve
        })
      }
      return result
    }
  })
  const page = await context.newPage()
  const errors = []
  const commandBodies = []
  page.on("pageerror", () => errors.push("pageerror"))
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/jobs/repair")) {
      commandBodies.push(request.postData())
    }
  })
  await page.goto(origin + "/jobs")
  await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
  const cookies = await context.cookies()
  const token = cookies.find((cookie) => cookie.name.includes("csrf")).value
  const post = async (path, body, status = 200) => {
    const response = await context.request.post(origin + path, {
      headers: {
        Origin: origin,
        "X-Playground-CSRF": token,
        "Content-Type": "application/json"
      },
      data: body
    })
    assert.equal(response.status(), status)
    return response.json()
  }
  const sandbox = await post("/api/sandbox")
  const ref = sandbox.ref
  const detail = async (jobId, scope = ref) => {
    const response = await context.request.get(
      `${origin}/api/jobs/detail?sandboxId=${scope.sandboxId}&generation=${scope.generation}&jobId=${jobId}`
    )
    assert.equal(response.status(), 200)
    return response.json()
  }
  const snapshot = async (jobId) =>
    (
      await query(
        `SELECT to_jsonb(j) AS job,p.payload,p.projection,to_jsonb(a) AS association,to_jsonb(l) AS ledger FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".job_payloads p ON p.job_id=j.id JOIN "${cfg.schema}".associations a ON a.job_id=j.id LEFT JOIN "${cfg.schema}".provider_ledger l ON l.job_id=j.id WHERE j.id=$1`,
        [jobId]
      )
    )[0]
  const unlock = async () => {
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(page.getByLabel("Readable payload")).toBeVisible()
  }
  const open = async (jobId, mode) => {
    if (mode === "drawer") {
      await page.goto(origin + "/jobs")
      await page.getByLabel("Kind (exact)").fill("playground.synthetic-document-export")
      await page.getByRole("button", { name: "Apply filters", exact: true }).click()
      await page.locator(`button[data-job-id="${jobId}"]`).click()
      await expect(page.getByRole("dialog", { name: "Quick job details" })).toBeVisible()
    } else {
      await page.goto(`${origin}/jobs/${jobId}?generation=${ref.generation}`)
    }
    await expect(page.getByLabel("Encoded payload")).toBeVisible()
  }
  const fillRepair = async (note) => {
    await page.getByRole("button", { name: "Correct and redrive", exact: true }).click()
    const editor = page.getByLabel("Validated synthetic replacement JSON")
    const value = JSON.parse(await editor.inputValue())
    assert.ok(value.document.note)
    await page
      .getByLabel("Reason (synthetic context only)")
      .fill("Synthetic document qualification")
    await page.getByLabel("Investigation", { exact: true }).selectOption("KnownFailure")
    await page.getByLabel("I confirm possible duplicate effects").check()
    await editor.fill(
      JSON.stringify({
        ...value,
        behavior: "success",
        document: { ...value.document, note }
      })
    )
    await expect(page.getByText("Changed: /document/note", { exact: true })).toBeVisible()
    await expect(page.getByText("Changed: /behavior", { exact: true })).toBeVisible()
    return { editor, value }
  }
  const baseCommand = (value, requestId = crypto.randomUUID()) => ({
    sandbox: ref,
    requestId,
    jobId: value.job.jobId,
    expectedState: value.job.state,
    expectedLifecycleVersion: value.job.lifecycleVersion,
    expectedResolutionVersion: value.problem?.version ?? 0,
    action: "corrected-redrive",
    payload: value.payload.encoded,
    reason: "Synthetic server rejection qualification",
    confirmDuplicateEffects: true,
    investigation: { _tag: "KnownFailure" }
  })
  const ids = []
  for (const mode of ["fullpage", "drawer"]) {
    report.stage = mode
    const note = `synthetic corrected document ${mode}`
    const jobId = await runtime.seed(cfg, ref, "dead", `synthetic original ${mode}`)
    ids.push(jobId)
    await runtime.drainRecorded()
    const before = await snapshot(jobId)
    assert.equal(before.job.state, "Dead")
    const source = await detail(jobId)
    assert.equal(source.payload.encryption, "SyntheticDocumentV1")
    assert.equal(source.eligibility.correctedRedrive.enabled, true)
    await open(jobId, mode)
    await expect(
      page.getByRole("button", { name: "Correct and redrive", exact: true })
    ).toBeDisabled()
    await page.getByRole("button", { name: "Copy payload", exact: true }).click()
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.getByLabel("Encoded payload").textContent()
    )
    await page.getByLabel("Demo unlock code").fill("wrong")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(
      page.getByText("Locked · authentication failed. Demo code: 123.", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Correct and redrive", exact: true })
    ).toBeDisabled()
    await unlock()
    await page.getByRole("button", { name: "Copy payload", exact: true }).click()
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.getByLabel("Readable payload").textContent()
    )
    const { editor, value } = await fillRepair(note)
    await editor.fill(
      JSON.stringify({ ...value, document: { ...value.document, note: "x".repeat(257) } })
    )
    await expect(
      page.getByRole("button", { name: "Submit repair", exact: true })
    ).toBeDisabled()
    await expect(
      page.getByRole("status").filter({ hasText: "schema-invalid:" })
    ).toBeVisible()
    await editor.fill(
      JSON.stringify({
        ...value,
        document: { ...value.document, tenant: "demo-tenant-b" }
      })
    )
    await expect(
      page.getByRole("button", { name: "Submit repair", exact: true })
    ).toBeDisabled()
    await expect(
      page.getByRole("status").filter({ hasText: "document-identity-mismatch:" })
    ).toBeVisible()
    // Explicit relock while the editor is open removes both readable states.
    await page.getByRole("button", { name: "Relock", exact: true }).last().click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByLabel("Readable payload")).toHaveCount(0)
    await page.getByRole("button", { name: "Copy payload", exact: true }).click()
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.getByLabel("Encoded payload").textContent()
    )
    await unlock()
    await fillRepair(note)
    // Cancellation after genuine AES encryption started must not issue a command.
    await page.evaluate(() => {
      window.__holdSeal = true
    })
    const count = commandBodies.length
    await page.getByRole("button", { name: "Submit repair", exact: true }).click()
    await expect(
      page.getByRole("status").filter({ hasText: "Encrypting and verifying" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Relock", exact: true }).last().click()
    await page.evaluate(() => {
      window.__holdSeal = false
      window.__releaseSeal?.()
    })
    await expect(page.getByLabel("Encoded payload")).toBeVisible()
    assert.equal(commandBodies.length, count)
    await unlock()
    await fillRepair(note)
    await page.screenshot({ path: `${directory}/${mode}-correction.png`, fullPage: true })
    // Lost browser response occurs only AFTER the actual server has committed.
    let committed, sent
    await page.route(
      "**/api/jobs/repair",
      async (route) => {
        sent = route.request().postDataJSON()
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        committed = await response.json()
        await route.abort("failed")
      },
      { times: 1 }
    )
    await page.getByRole("button", { name: "Submit repair", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Check repair receipt", exact: true })
    ).toBeVisible()
    assert.equal(committed._tag, "Committed")
    assert.equal(committed.problem.state, "InProgress")
    assert.equal(committed.sourceJobId, jobId)
    assert.equal(sent.payload.document.note, undefined)
    assert.equal(JSON.stringify(sent).includes(note), false)
    assert.equal(JSON.stringify(sent).includes(cfg.encryptionKey), false)
    assert.notDeepEqual(
      sent.payload.document.nonce,
      source.payload.encoded.document.nonce
    )
    assert.notEqual(
      sent.payload.document.fingerprint,
      source.payload.encoded.document.fingerprint
    )
    await page.getByRole("button", { name: "Check repair receipt", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Check repair receipt", exact: true })
    ).toHaveCount(0)
    // Replay is exact; conflicting request reuse fails, including fresh encryption randomness.
    assert.deepEqual(await post("/api/jobs/repair", sent), committed)
    const conflict = await post("/api/jobs/repair", {
      ...sent,
      reason: "conflicting reason"
    })
    assert.equal(conflict.reason, "request-conflict")
    await runtime.drainRecorded()
    await runtime.drainRecorded()
    const after = await snapshot(jobId)
    assert.deepEqual(after, before)
    const successor = await snapshot(committed.resultJobId)
    assert.equal(successor.job.state, "Completed")
    assert.equal(Number(successor.job.attempts_made), 1)
    assert.equal(Number(successor.job.stalled_count), 0)
    assert.deepEqual(successor.job.policy, before.job.policy)
    assert.equal(successor.job.source_job_id, jobId)
    assert.equal(successor.job.redrive_kind, "CorrectedRedrive")
    const decoded = await runtime.decodeArtifact(successor.payload, successor.projection)
    assert.equal(decoded.document.note, note)
    assert.equal(decoded.behavior, "success")
    const successorWire = JSON.parse(successor.payload.toString("utf8"))
    assert.equal(successorWire.document.fingerprint, sent.payload.document.fingerprint)
    assert.equal(successor.payload.toString("utf8").includes(note), false)
    const current = await detail(jobId)
    assert.equal(current.problem.state, "Resolved")
    assert.equal(current.problem.resolution.kind, "SuccessorCompleted")
    const [audit] = await query(
      `SELECT fact FROM "${cfg.schema}".repair_audit WHERE root_job_id=$1 AND action='corrected-redrive'`,
      [jobId]
    )
    assert.ok(audit)
    assert.equal(JSON.stringify(audit).includes(note), false)
    report.cases.push({
      mode,
      sourceJobId: jobId,
      successorJobId: committed.resultJobId,
      sourceState: before.job.state,
      successorState: successor.job.state,
      decodedDocumentMatches: true,
      sourceImmutable: true,
      requestId: sent.requestId,
      problem: current.problem.state
    })
    report.checks.push(
      `${mode}: stored Dead unlock123/edit/validation/diff/relock/cancel native crypto/lost response/exact receipt/command conflict/real executor/envelope HMAC/fresh budget/lineage/resolution/source immutable/clipboard`
    )
  }
  console.log(
    JSON.stringify({
      checkpoint: report.stage,
      checks: report.checks,
      cases: report.cases
    })
  )
  report.stage = "server guards and isolated outcome"
  const guardId = await runtime.seed(cfg, ref, "dead", "synthetic guard source")
  await runtime.drainRecorded()
  const guardDetail = await detail(guardId)
  const guardBefore = await snapshot(guardId)
  for (const delta of [
    {
      document: { ...guardDetail.payload.encoded.document, fingerprint: "0".repeat(64) }
    },
    {
      document: {
        subject: "demo-customer",
        tenant: "demo-tenant-a",
        note: "plaintext must fail"
      }
    },
    { sandbox: { ...ref, generation: ref.generation + 1 } },
    { actor: "other" }
  ]) {
    const result = await post("/api/jobs/repair", {
      ...baseCommand(guardDetail),
      payload: { ...guardDetail.payload.encoded, ...delta }
    })
    assert.equal(result._tag, "Rejected")
    assert.equal(result.reason, "invalid-payload")
  }
  const wrongVersion = await post("/api/jobs/repair", {
    ...baseCommand(guardDetail),
    expectedLifecycleVersion: guardDetail.job.lifecycleVersion + 1
  })
  assert.equal(wrongVersion.reason, "state-version-conflict")
  const isolatedId = await runtime.seed(cfg, ref, "isolated", "synthetic isolated source")
  await runtime.drainRecorded()
  const isolatedDetail = await detail(isolatedId)
  assert.equal(isolatedDetail.job.state, "Isolated")
  const unconfirmed = await post("/api/jobs/repair", {
    ...baseCommand(isolatedDetail),
    investigation: { _tag: "Unconfirmed" }
  })
  assert.equal(unconfirmed.reason, "investigation-required")
  await open(isolatedId, "fullpage")
  await unlock()
  await fillRepair("synthetic isolated corrected")
  await page
    .getByLabel("Investigation", { exact: true })
    .selectOption("AcceptDuplicateRisk")
  await page
    .getByLabel("Investigation reason")
    .fill("Investigated synthetic unknown effect")
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/jobs/repair") &&
      response.request().method() === "POST"
  )
  const [isolatedResponse] = await Promise.all([
    responsePromise,
    page.getByRole("button", { name: "Submit repair", exact: true }).click()
  ])
  const isolatedReceipt = await isolatedResponse.json()
  assert.equal(isolatedReceipt._tag, "Committed")
  assert.equal(isolatedReceipt.problem.outcomeKnowledge, "Unknown")
  await runtime.drainRecorded()
  await runtime.drainRecorded()
  const stillUnknown = await detail(isolatedId)
  assert.equal(stillUnknown.problem.state, "Open")
  assert.equal(stillUnknown.problem.outcomeKnowledge, "Unknown")
  assert.equal((await snapshot(isolatedReceipt.resultJobId)).job.state, "Completed")
  report.checks.push(
    "Isolated correction requires investigation; completed successor preserves unknown outcome and reopens for reconciliation; tamper/plaintext/identity/state refused server-side"
  )
  // Same-data redrive remains eligible and preserves document semantics.
  const sameId = await runtime.seed(cfg, ref, "dead", "synthetic unchanged document")
  await runtime.drainRecorded()
  const sameDetail = await detail(sameId)
  const sameBefore = await snapshot(sameId)
  const command = baseCommand(sameDetail)
  delete command.payload
  command.action = "redrive"
  const sameResult = await post("/api/jobs/repair", command)
  assert.equal(sameResult._tag, "Committed")
  const sameAfter = await snapshot(sameResult.resultJobId)
  assert.deepEqual(sameAfter.payload, sameBefore.payload)
  assert.deepEqual(sameAfter.projection, sameBefore.projection)
  assert.equal(sameAfter.job.redrive_kind, "Redrive")
  report.checks.push(
    "same-data encrypted redrive uses unchanged artifact and distinct Redrive lineage"
  )
  console.log(JSON.stringify({ checkpoint: report.stage, checks: report.checks }))
  report.stage = "navigation and generation"
  await open(guardId, "fullpage")
  await unlock()
  await fillRepair("synthetic stale navigation edit")
  await page.evaluate(() => {
    window.__holdSeal = true
  })
  const count = commandBodies.length
  await page.getByRole("button", { name: "Submit repair", exact: true }).click()
  await page.goto(`${origin}/jobs/${ids[0]}?generation=${ref.generation}`)
  await expect(page.getByLabel("Encoded payload")).toBeVisible()
  assert.equal(commandBodies.length, count)
  await open(guardId, "fullpage")
  await unlock()
  await page.goto(`${origin}/jobs/${guardId}?generation=${ref.generation + 1}`)
  await expect(page.getByLabel("Readable payload")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Correct and redrive", exact: true })
  ).toHaveCount(0)
  await page.goto(origin + "/jobs")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  const resetResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/sandbox/reset")
  )
  page.once("dialog", (dialog) => dialog.accept())
  await Promise.all([
    resetResponse,
    page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  ])
  const stale = await post("/api/jobs/repair", baseCommand(guardDetail), 409)
  assert.ok(stale)
  assert.deepEqual(await snapshot(guardId), guardBefore)
  report.checks.push(
    "navigation during native seal emits no stale command; wrong generation hides editor; actual reset invalidates prior repair scope atomically"
  )
  report.stage = "public refusal"
  const [publicJob] = await query(
    `SELECT j.id FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.kind='playground.synthetic-document-export' LIMIT 1`,
    [recorded.ref.sandboxId]
  )
  await page.goto(
    `${origin}/demo/jobs/${publicJob.id}?generation=${recorded.ref.generation}`
  )
  await unlock()
  assert.equal(
    await page.getByRole("button", { name: "Correct and redrive", exact: true }).count(),
    0
  )
  for (const path of ["/api/demo/jobs/repair", "/api/demo/jobs/resolution"]) {
    const response = await context.request.post(origin + path, {
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Local-Private": "true"
      },
      data: baseCommand(guardDetail)
    })
    assert.equal(response.status(), 404)
  }
  assert.deepEqual(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    [0, 0]
  )
  assert.equal(
    await page.locator('[aria-label*="How"], details[aria-label*="explain"]').count(),
    0
  )
  assert.deepEqual(errors, [])
  report.checks.push(
    "public demo can decrypt/copy recorded synthetic data but has no correction UI or mutation APIs; storage empty; production browser no page errors"
  )
  report.success = true
} catch (error) {
  // Bounded synthetic-only diagnostics; no private config/SQL/provider errors.
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    if (pages[0]) {
      await pages[0]
        .screenshot({ path: `${directory}/failure.png`, fullPage: true })
        .catch(() => undefined)
      report.visible = (
        await pages[0]
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(-2500)
    }
  }
  report.failure = {
    name: error?.name ?? "unknown",
    message: String(error?.message ?? "").slice(0, 1500)
  }
  process.exitCode = 1
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
  report.cleanup = { browser: true, workerd: true, pool: true }
  writeFileSync(
    `${directory}/synthetic-browser-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
