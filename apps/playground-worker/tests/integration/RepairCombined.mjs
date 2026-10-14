// Foreground real PG/workerd/production browser slice; no HTTP fixture replacement.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"

const directory = process.env.D6_RESOURCE_DIRECTORY
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const pool = new Pool({ ...cfg, connectionTimeoutMillis: 2000, statement_timeout: 5000 })
const report = { checks: [], failures: [], stage: "stored seed", success: false }
const remainingOnly = process.env.REPAIR_REMAINING_ONLY === "true"
const selectedGroup = process.env.REPAIR_BROWSER_GROUP
const missingOnly = process.env.REPAIR_MISSING_ONLY === "true"
let local, browser, publicLocal
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
  if (!missingOnly && !remainingOnly) {
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
  }
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
  if (!missingOnly && !remainingOnly) {
    for (const host of ["127.0.0.1", "localhost"]) {
      const origin = local.origin.replace("127.0.0.1", host)
      await page.goto(
        `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
      )
      await page.getByLabel("Demo unlock code").waitFor({ timeout: 15000 })
      await page.getByLabel("Demo unlock code").fill("wrong")
      await page.getByRole("button", { name: "Unlock locally" }).click()
      assert.equal(await page.getByLabel("Locally decrypted document").count(), 0)
      await page.getByLabel("Demo unlock code").fill("123")
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
  }
  report.runtime = { chromium: browser.version() }
  const origin = local.origin
  const scenario = async (name, run) => {
    if (
      selectedGroup &&
      !selectedGroup.split(",").some((group) => name.includes(group))
    ) {
      return
    }
    report.stage = name
    try {
      await run()
      report.checks.push(name)
    } catch (error) {
      report.failures.push({
        stage: name,
        failureClass: error instanceof Error ? error.name : "Unknown",
        site:
          error instanceof Error
            ? error.stack?.match(/RepairCombined\.mjs:\d+:\d+/)?.[0]
            : undefined
      })
    }
  }
  if (!missingOnly && !selectedGroup) {
    if (remainingOnly) {
      await page.goto(`${origin}/demo`)
      await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
    }
    try {
      report.stage = "stored demo navigation, filter and return focus"
      if (!remainingOnly) {
        await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
      }
      await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
      report.stage = "stored list first selection"
      const first = page.locator(".job-list tr button").first()
      const selectedId = await first.innerText()
      await first.click()
      await expect(page.getByRole("dialog")).toBeVisible()
      report.stage = "stored drawer Escape and focus"
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(
        page.getByRole("button", { name: selectedId, exact: true })
      ).toBeFocused()
      await page.getByRole("button", { name: selectedId, exact: true }).click()
      report.stage = "stored drawer full details"
      await page.getByRole("button", { name: "Open full details", exact: true }).click()
      await expect(
        page.getByRole("heading", { name: "Job details", exact: true })
      ).toBeVisible()
      await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
      await expect(
        page.getByRole("button", { name: selectedId, exact: true })
      ).toBeFocused()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole("button", { name: selectedId, exact: true }).click()
      await page.getByRole("button", { name: "Close job details", exact: true }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await page.setViewportSize({ width: 1280, height: 900 })
      report.checks.push("stored demo drawer/Escape/focus/full/Back/mobile close")
    } catch (error) {
      report.failures.push({
        stage: report.stage,
        failureClass: error instanceof Error ? error.name : "Unknown",
        expected: "selected job button receives focus after Escape/Back",
        activeElement: await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          jobId: document.activeElement?.getAttribute("data-job-id"),
          fallback: document.activeElement?.hasAttribute("data-jobs-focus-fallback")
        }))
      })
    }
    if (!remainingOnly) {
      report.stage = "stored ciphertext tamper, relock and generation fencing"
      const [original] = await query(
        `SELECT payload FROM "${cfg.schema}".job_payloads WHERE job_id=$1`,
        [encrypted.id]
      )
      const tampered = JSON.parse(Buffer.from(original.payload).toString("utf8"))
      tampered.document.ciphertext[0] ^= 1
      try {
        await query(
          `UPDATE "${cfg.schema}".job_payloads SET payload=$2 WHERE job_id=$1`,
          [encrypted.id, Buffer.from(JSON.stringify(tampered))]
        )
        await page.goto(
          `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
        )
        await page.getByLabel("Demo unlock code").fill("123")
        await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
        await expect(
          page.getByText(
            "Locked; demo code or document authentication failed. Use demo code 123.",
            {
              exact: true
            }
          )
        ).toBeVisible()
        await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
      } finally {
        await query(
          `UPDATE "${cfg.schema}".job_payloads SET payload=$2 WHERE job_id=$1`,
          [encrypted.id, original.payload]
        )
      }
      await page.reload()
      await page.getByLabel("Demo unlock code").fill("123")
      await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
      await expect(page.getByLabel("Locally decrypted document")).toBeVisible()
      await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
      await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
      await page.goto(
        `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation + 1}`
      )
      await expect(page.getByLabel("Demo unlock code")).toHaveCount(0)
      report.checks.push(
        "actual stored ciphertext tamper rejects; original bytes restored; navigation relock and stale generation"
      )
    }
  } else if (missingOnly) {
    report.inheritedFailure = {
      receipt: "browser-final-attempt/combined-receipt.json",
      stage: "stored drawer Escape and focus"
    }
  }
  if (remainingOnly) {
    await scenario(
      "actual stored page/cursor/scroll/full/browser Back preservation",
      async () => {
        await page.goto(`${origin}/demo`)
        await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
        await page.getByLabel("Rows per page").selectOption("20")
        const nextResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/demo/jobs" &&
            url.searchParams.has("cursor") &&
            response.status() === 200
          )
        })
        await page.getByRole("button", { name: "Next page", exact: true }).click()
        const response = await nextResponse
        const cursor = new URL(response.url()).searchParams.get("cursor")
        assert.ok(cursor)
        await expect(
          page.getByRole("button", { name: "Page 2", exact: true })
        ).toHaveAttribute("aria-current", "page")
        const id = await page.locator("button[data-job-id]").first().innerText()
        await page.getByRole("button", { name: id, exact: true }).click()
        await expect(page.getByRole("dialog")).toBeVisible()
        await page.evaluate(() => window.scrollTo(0, 300))
        const scrollY = await page.evaluate(() => window.scrollY)
        assert.ok(scrollY > 0)
        await page.getByRole("button", { name: "Open full details", exact: true }).click()
        await expect(
          page.getByRole("heading", { name: "Job details", exact: true })
        ).toBeVisible()
        const returnedResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/demo/jobs" &&
            url.searchParams.get("cursor") === cursor &&
            response.status() === 200
          )
        })
        await page.goBack()
        await returnedResponse
        await expect(
          page.getByRole("button", { name: "Page 2", exact: true })
        ).toHaveAttribute("aria-current", "page")
        await expect(page.getByLabel("Rows per page")).toHaveValue("20")
        await expect(page.getByRole("button", { name: id, exact: true })).toBeFocused()
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
        assert.equal(new URL(page.url()).searchParams.get("view"), "jobs")
      }
    )
    await scenario(
      "actual stored problem view/filter/full/related/Back preservation",
      async () => {
        await page.goto(`${origin}/demo`)
        await page.getByLabel("Resolution", { exact: true }).selectOption("Resolved")
        await page.getByLabel("Kind (exact)").fill("playground.welcome-email")
        await page.getByRole("button", { name: "Apply filters", exact: true }).click()
        await expect(page.locator("button[data-job-id]").first()).toBeVisible()
        const id = await page.locator("button[data-job-id]").first().innerText()
        await page.getByRole("button", { name: id, exact: true }).click()
        await page.getByRole("button", { name: "Open full details", exact: true }).click()
        await expect(
          page.getByRole("heading", { name: "Job details", exact: true })
        ).toBeVisible()
        const related = page.getByRole("button", { name: /^Open related job / }).first()
        const relatedId = (await related.getAttribute("aria-label")).slice(
          "Open related job ".length
        )
        await related.click()
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(`/demo/jobs/${relatedId}`)
        await expect(
          page.getByRole("heading", { name: "Job details", exact: true })
        ).toBeVisible()
        await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
        await expect(page.getByLabel("Resolution", { exact: true })).toHaveValue(
          "Resolved"
        )
        await expect(page.getByLabel("Kind (exact)")).toHaveValue(
          "playground.welcome-email"
        )
        assert.equal(new URL(page.url()).searchParams.get("view"), "problems")
        await expect(page.getByRole("button", { name: id, exact: true })).toBeFocused()
      }
    )
    await scenario(
      "actual stored direct link/mobile/full/Back safe fallback",
      async () => {
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
        try {
          const tab = await mobile.newPage()
          await tab.goto(
            `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
          )
          await expect(tab.getByLabel("Demo unlock code")).toBeVisible()
          await tab.getByRole("button", { name: "Back to jobs", exact: true }).click()
          await expect(tab.getByRole("table", { name: "Background jobs" })).toBeVisible()
          await expect(tab.locator("[data-jobs-focus-fallback]")).toBeFocused()
          const id = await tab.locator("button[data-job-id]").first().innerText()
          await tab.getByRole("button", { name: id, exact: true }).click()
          await expect(tab.getByRole("dialog")).toBeVisible()
          await tab
            .getByRole("button", { name: "Open full details", exact: true })
            .click()
          await expect(
            tab.getByRole("heading", { name: "Job details", exact: true })
          ).toBeVisible()
          await tab.getByRole("button", { name: "Back to jobs", exact: true }).click()
          await expect(tab.getByRole("button", { name: id, exact: true })).toBeFocused()
        } finally {
          await mobile.close()
        }
      }
    )
    await scenario(
      "actual stored live read retains dialog and restores exact identity",
      async () => {
        await page.goto(`${origin}/demo`)
        const id = await page.locator("button[data-job-id]").first().innerText()
        await page.getByRole("button", { name: id, exact: true }).click()
        await expect(page.getByRole("dialog")).toBeVisible()
        const dialog = await page.getByRole("dialog").elementHandle()
        const refreshed = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/demo/jobs" &&
            response.status() === 200
        )
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
        await refreshed
        await expect(page.getByRole("dialog")).toBeVisible()
        assert.equal(await dialog.evaluate((node) => node.isConnected), true)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("dialog")).toHaveCount(0)
        await expect(page.getByRole("button", { name: id, exact: true })).toBeFocused()
      }
    )
    await scenario("actual stored state-filter full/Back preservation", async () => {
      await page.goto(`${origin}/demo`)
      await page.getByLabel("State", { exact: true }).selectOption("Completed")
      await page.getByRole("button", { name: "Apply filters", exact: true }).click()
      await expect(page.getByRole("tab", { name: /^Completed/ })).toHaveAttribute(
        "aria-selected",
        "true"
      )
      const id = await page.locator("button[data-job-id]").first().innerText()
      await page.getByRole("button", { name: id, exact: true }).click()
      await page.getByRole("button", { name: "Open full details", exact: true }).click()
      await expect(
        page.getByRole("heading", { name: "Job details", exact: true })
      ).toBeVisible()
      await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
      await expect(page.getByLabel("State", { exact: true })).toHaveValue("Completed")
      await expect(page.getByRole("button", { name: id, exact: true })).toBeFocused()
    })
    await scenario(
      "actual stored in-flight real decrypt/navigation/new identity fences completion",
      async () => {
        await page.goto(
          `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
        )
        await expect(page.getByLabel("Demo unlock code")).toBeVisible()
        // Hold the real Web Crypto completion, never substitute ciphertext or HTTP.
        await page.evaluate(() => {
          const original = crypto.subtle.decrypt.bind(crypto.subtle)
          let release
          const gate = new Promise((done) => {
            release = done
          })
          window.__repairDecrypt = { entered: false, finished: false, release, original }
          crypto.subtle.decrypt = async (...args) => {
            window.__repairDecrypt.entered = true
            const result = await original(...args)
            await gate
            window.__repairDecrypt.finished = true
            return result
          }
        })
        await page.getByLabel("Demo unlock code").fill("123")
        await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
        await expect
          .poll(() => page.evaluate(() => window.__repairDecrypt.entered))
          .toBe(true)
        await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
        await expect(page.getByRole("table", { name: "Background jobs" })).toBeVisible()
        const id = await page.locator("button[data-job-id]").first().innerText()
        assert.notEqual(id, encrypted.id)
        await page.getByRole("button", { name: id, exact: true }).click()
        await expect(page.getByRole("dialog")).toBeVisible()
        await page.evaluate(() => window.__repairDecrypt.release())
        await expect
          .poll(() => page.evaluate(() => window.__repairDecrypt.finished))
          .toBe(true)
        await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
        await page.keyboard.press("Escape")
        // Reopen original identity without full document reload; old completion stays revoked.
        await page.getByLabel("Search job ID on this page").fill(encrypted.id)
        if (await page.getByRole("button", { name: encrypted.id, exact: true }).count()) {
          await page.getByRole("button", { name: encrypted.id, exact: true }).click()
          await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
          await expect(page.getByLabel("Locally decrypted document")).toHaveCount(0)
        } else {
          throw new Error("Original encrypted identity not retained on this page")
        }
        await page.evaluate(() => {
          crypto.subtle.decrypt = window.__repairDecrypt.original
          delete window.__repairDecrypt
        })
        assert.deepEqual(
          await page.evaluate(() => [localStorage.length, sessionStorage.length]),
          [0, 0]
        )
      }
    )
    await scenario(
      "actual stored browser expiry removes unlocked content and prevents remount",
      async () => {
        const expiredContext = await browser.newContext()
        try {
          const tab = await expiredContext.newPage()
          await tab.clock.install({ time: new Date() })
          await tab.goto(
            `${origin}/demo/jobs/${encrypted.id}?generation=${sandbox.ref.generation}`
          )
          await tab.getByLabel("Demo unlock code").fill("123")
          await tab.getByRole("button", { name: "Unlock locally", exact: true }).click()
          await expect(tab.getByLabel("Locally decrypted document")).toBeVisible()
          // Advance only browser time beyond the actual stored admission expiry.
          // DB time, authority, history and production bundle remain unchanged.
          const advance =
            sandbox.expiresAt - (await tab.evaluate(() => Date.now())) + 2000
          assert.ok(advance > 0)
          await tab.clock.fastForward(advance)
          await expect(tab.getByLabel("Locally decrypted document")).toHaveCount(0)
          await expect(tab.getByLabel("Demo unlock code")).toHaveCount(0)
          await tab.getByRole("button", { name: "Back to jobs", exact: true }).click()
          await expect(tab.getByLabel("Locally decrypted document")).toHaveCount(0)
          assert.deepEqual(
            await tab.evaluate(() => [localStorage.length, sessionStorage.length]),
            [0, 0]
          )
          report.expiryMethod =
            "bounded browser-clock advance past actual PG sandbox.expiresAt; natural DB-time expiry not retested"
        } finally {
          await expiredContext.close()
        }
      }
    )
    assert.deepEqual(errors, [])
    assert.ok(requests.every((request) => request.method === "GET"))
    assert.ok(requests.every((request) => !request.url.includes(cfg.encryptionKey)))
    report.checks.push(
      "remaining browser groups: no page errors, mutations or private key transmission"
    )
  }
  if (!remainingOnly) {
    report.stage = "trusted private browser correction and actual reconciliation"
    const privateContext = await browser.newContext()
    const privatePage = await privateContext.newPage()
    await privatePage.goto(`${origin}/jobs`)
    await expect(
      privatePage.getByRole("table", { name: "Background jobs" })
    ).toBeVisible()
    const cookies = await privateContext.cookies()
    const token = cookies.find((cookie) => cookie.name.includes("csrf")).value
    const post = async (path, body) => {
      const response = await privateContext.request.post(origin + path, {
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
    const described = await post("/api/sandbox")
    const ref = described.ref
    await post("/api/scenarios", {
      sandbox: ref,
      requestId: crypto.randomUUID(),
      scenario: "terminal-failure",
      count: 6
    })
    await runtime.drainRecorded()
    await runtime.drainRecorded()
    const [known] = await query(
      `SELECT j.id FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.kind='playground.welcome-email' AND j.state='Dead' ORDER BY j.id LIMIT 1`,
      [ref.sandboxId, ref.generation]
    )
    assert.ok(known)
    await privatePage.goto(`${origin}/jobs/${known.id}?generation=${ref.generation}`)
    await privatePage
      .getByRole("button", { name: "Correct and redrive", exact: true })
      .click()
    await privatePage
      .getByLabel("Reason (synthetic context only)")
      .fill("Recorded browser qualification correction")
    await privatePage
      .getByLabel("Investigation", { exact: true })
      .selectOption("KnownFailure")
    await privatePage.getByLabel("I confirm possible duplicate effects").check()
    const editor = privatePage.getByLabel("Validated synthetic replacement JSON")
    const payload = JSON.parse(await editor.inputValue())
    await editor.fill("{}")
    await expect(
      privatePage.getByRole("button", { name: "Submit repair", exact: true })
    ).toBeDisabled()
    await editor.fill(JSON.stringify({ ...payload, behavior: "success" }))
    await expect(
      privatePage.getByText("Changed: /behavior", { exact: true })
    ).toBeVisible()
    await privatePage.getByRole("button", { name: "Submit repair", exact: true }).click()
    await expect(privatePage.getByRole("dialog")).toHaveCount(0)
    await runtime.drainRecorded()
    await runtime.drainRecorded()
    await privatePage.reload()
    await expect(privatePage.getByLabel("Repair and resolution")).toContainText(
      "Resolved"
    )
    const [resolved] = await query(
      `SELECT j.state,p.problem FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".job_problems p ON p.root_job_id=j.id WHERE j.id=$1`,
      [known.id]
    )
    assert.equal(resolved.state, "Dead")
    assert.equal(resolved.problem.state, "Resolved")
    const [successor] = await query(
      `SELECT state FROM "${cfg.schema}".jobs WHERE id=$1`,
      [resolved.problem.activeSuccessorJobId]
    )
    assert.equal(successor.state, "Completed")
    report.checks.push(
      "private actual browser invalid schema/diff/corrected repair -> actual worker Completed and separate Resolved; source remains Dead"
    )

    report.stage = "actual unknown problem browser manual close"
    await post("/api/scenarios", {
      sandbox: ref,
      requestId: crypto.randomUUID(),
      scenario: "isolated",
      count: 6
    })
    await runtime.drainRecorded()
    const [unknown] = await query(
      `SELECT j.id FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.state='Isolated' ORDER BY j.id LIMIT 1`,
      [ref.sandboxId, ref.generation]
    )
    assert.ok(unknown)
    await privatePage.goto(`${origin}/jobs/${unknown.id}?generation=${ref.generation}`)
    await privatePage.getByRole("button", { name: "Close problem", exact: true }).click()
    await privatePage
      .getByLabel("Reason (synthetic context only)")
      .fill("Explicit synthetic investigation closure")
    await expect(
      privatePage.getByRole("button", { name: "Record resolution", exact: true })
    ).toBeDisabled()
    await privatePage.getByLabel("I acknowledge unresolved external effects").check()
    await privatePage
      .getByRole("button", { name: "Record resolution", exact: true })
      .click()
    await expect(privatePage.getByRole("dialog")).toHaveCount(0)
    await privatePage.reload()
    await expect(privatePage.getByLabel("Repair and resolution")).toContainText(
      "Resolved"
    )
    const [manual] = await query(
      `SELECT j.state,p.problem FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".job_problems p ON p.root_job_id=j.id WHERE j.id=$1`,
      [unknown.id]
    )
    assert.equal(manual.state, "Isolated")
    assert.equal(manual.problem.outcomeKnowledge, "Unknown")
    assert.equal(manual.problem.resolution.kind, "ManualClose")
    report.checks.push(
      "actual browser unknown manual close requires acknowledgement and preserves execution/knowledge"
    )

    report.stage = "actual scoped execution and problem counts/pagination"
    const get = async (path) => {
      const response = await privateContext.request.get(origin + path)
      assert.equal(response.status(), 200)
      return response.json()
    }
    const base = `sandboxId=${ref.sandboxId}&generation=${ref.generation}`
    const jobs = await get(`/api/jobs?${base}&limit=1`)
    const problems = await get(`/api/jobs/problems?${base}&limit=1`)
    const counts = await query(
      `SELECT j.state,count(*)::int AS n FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND a.generation=$2 GROUP BY j.state`,
      [ref.sandboxId, ref.generation]
    )
    for (const { state, n } of counts) {
      assert.equal(jobs.stats[state], n)
    }
    assert.equal(
      jobs.stats.total,
      counts.reduce((n, row) => n + row.n, 0)
    )
    assert.deepEqual(problems.stats, jobs.stats)
    assert.equal(
      problems.attentionStats.needsAttention,
      problems.attentionStats.Open + problems.attentionStats.InProgress
    )
    assert.ok(problems.nextCursor)
    const next = await get(
      `/api/jobs/problems?${base}&limit=1&cursor=${encodeURIComponent(problems.nextCursor)}`
    )
    assert.notEqual(next.items[0].problem.rootJobId, problems.items[0].problem.rootJobId)
    const filtered = await get(`/api/jobs/problems?${base}&limit=1&resolution=Resolved`)
    assert.equal(filtered.items[0].problem.state, "Resolved")
    assert.deepEqual(filtered.stats, jobs.stats)
    report.checks.push(
      "real PG global execution stats remain independent of resolution; one chain/problem; filtered signed problem pagination"
    )

    report.stage = "public config server-side private admission rejection"
    publicLocal = await createLocal(cfg, { https: false, localPrivate: false })
    for (const host of ["127.0.0.1", "localhost"]) {
      const publicOrigin = publicLocal.origin.replace("127.0.0.1", host)
      for (const path of [
        "/jobs",
        `/jobs/${known.id}`,
        "/api/sandbox/issue",
        "/api/jobs/repair",
        "/api/jobs/resolution",
        "/api/demo/jobs/repair",
        "/api/demo/jobs/resolution"
      ]) {
        const response = await publicLocal.mf.dispatchFetch(publicOrigin + path, {
          method: path.startsWith("/api") ? "POST" : "GET",
          headers: {
            Origin: publicOrigin,
            "X-Local-Private": "true",
            Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
          },
          ...(path.startsWith("/api") ? { body: "{}" } : {})
        })
        assert.equal(response.status, 404)
      }
    }
    report.checks.push(
      "both aliases false-config private pages/mutations and public demo mutations reject spoofed private flag/cookies"
    )
    await privateContext.close()
  }
  report.currentSliceSuccess = report.failures.length === 0
  report.success = report.currentSliceSuccess && !report.inheritedFailure
  if (!report.success) {
    process.exitCode = 1
  }
} catch (error) {
  report.failureClass = error instanceof Error ? error.name : "Unknown"
  report.failureSite =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .filter((line) => /RepairCombined\.mjs:\d+/.test(line))
          .map((line) => line.match(/RepairCombined\.mjs:\d+:\d+/)?.[0])
      : undefined
  report.sqlFailure = safeFailure?.(error)
  process.exitCode = 1
} finally {
  if (browser) {
    await browser.close()
  }
  if (publicLocal) {
    await publicLocal.mf.dispose()
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
