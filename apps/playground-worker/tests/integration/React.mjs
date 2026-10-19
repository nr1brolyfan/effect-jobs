// Real PG/workerd/Chromium boundary; lifecycle observations come only from API/DB.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"

const evidence = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({ host: "127.0.0.1", ...cfg, connectionTimeoutMillis: 2000 })
const checks = []
let local, browser, page, retryLock
const errors = []
const cspErrors = []
const network = []
const websocketEvents = []
const until = async (test, label, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while (!(await test())) {
    assert(Date.now() < deadline, label)
    await new Promise((done) => setTimeout(done, 200))
  }
}
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
  local = await createLocal(cfg)
  assert.notEqual(new URL(local.origin).port, "8787")
  const dispatch = (path, options) => local.mf.dispatchFetch(local.origin + path, options)
  const css = await (await dispatch("/Jobs.css")).text()
  assert.equal(css, readFileSync("apps/website/dist/Jobs.css", "utf8"))
  assert(css.includes("@media") && css.includes("--"))
  checks.push("production extracted StyleX CSS served byte-for-byte by workerd assets")
  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors"]
  })
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    timezoneId: "Europe/Warsaw"
  })
  page = await context.newPage()
  // Capture real transports only to inject a socket disconnect later. Messages,
  // authority and lifecycle continue to come from the production server.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.qualificationSockets = []
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args)
        window.qualificationSockets.push(this)
      }
    }
  })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (msg) => {
    if (/content security policy/i.test(msg.text())) {
      cspErrors.push(msg.text())
    }
  })
  let sockets = 0,
    frames = 0,
    reads = 0
  page.on("websocket", (socket) => {
    sockets++
    websocketEvents.push("opened")
    socket.on("close", () => websocketEvents.push("closed"))
    socket.on("framereceived", () => frames++)
  })
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith("/api/")) {
      network.push({ path, status: response.status() })
    }
  })
  page.on("request", (req) => {
    if (/\/api\/(demo\/)?jobs\?/.test(req.url())) {
      reads++
    }
  })
  const connected = () =>
    page.locator('.connection-status[data-connection="connected"]').waitFor()
  await page.goto(local.origin + "/demo")
  await connected()
  await expect(page.locator(".job-list tr")).toHaveCount(5)
  // Native details excludes collapsed controls from the accessibility tree.
  // Open the launcher before checking the demo's actual disabled capabilities.
  await page.locator(".scenario-panel summary").click()
  assert(
    await page.getByRole("button", { name: "Create jobs", exact: true }).isDisabled()
  )
  assert(
    await page.getByRole("button", { name: "Run scenario", exact: true }).isDisabled()
  )
  assert(
    await page.getByRole("button", { name: "Reset my sandbox", exact: true }).isDisabled()
  )
  assert.equal((await dispatch("/api/demo/scenarios", { method: "POST" })).status, 400)
  const demo = await (await dispatch("/api/demo")).json()
  const list = async (extra = {}) => {
    const response = await dispatch(
      "/api/demo/jobs?" +
        new URLSearchParams({
          sandboxId: demo.ref.sandboxId,
          generation: String(demo.ref.generation),
          limit: "5",
          ...extra
        })
    )
    assert.equal(response.status, 200)
    return response.json()
  }
  const first = await list()
  assert(first.nextCursor)
  const next = await list({ cursor: first.nextCursor })
  assert(!first.items.some((a) => next.items.some((b) => a.jobId === b.jobId)))
  const dead = await list({ state: "Dead", limit: "1" })
  assert.equal(dead.items.length, 1)
  assert.equal(dead.items[0].state, "Dead")
  assert(dead.stats.total >= 30 && dead.stats.Dead >= 6)
  checks.push(
    "demo write denial, real server cursor/filter, global statistics independent of filtered page"
  )
  await page.getByRole("tab", { name: /^Retry scheduled/ }).click()
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await expect(page.locator(".job-list .status-cell").first()).toHaveText(
    "Retry scheduled"
  )
  await page.locator(".job-list .job-id").first().click()
  const details = page.getByRole("region", { name: "Job details" })
  await details.getByText("Retry delay", { exact: true }).waitFor()
  const retryTime = details.locator(".retry-schedule time")
  const persisted = Date.parse(await retryTime.getAttribute("datetime"))
  assert(Number.isFinite(persisted))
  const jobId = (
    await details
      .locator("dt")
      .filter({ hasText: /^Job ID$/ })
      .locator("..")
      .locator("dd")
      .textContent()
  ).trim()
  // Hold this real retry row through its persisted deadline. SKIP LOCKED keeps
  // other workers running and leaves this job eligible, waiting for a worker.
  // No timestamps, state, browser clocks or lifecycle results are rewritten.
  retryLock = await pool.connect()
  await retryLock.query("BEGIN")
  const row = (
    await retryLock.query(
      `SELECT available_at,state FROM "${cfg.schema}".jobs WHERE id=$1 FOR UPDATE`,
      [jobId]
    )
  ).rows[0]
  assert.equal(row.state, "RetryScheduled")
  assert.equal(Number(row.available_at), persisted)
  const localTime = await page.evaluate(
    (millis) =>
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short"
      }).format(millis),
    persisted
  )
  assert.equal(await retryTime.textContent(), localTime)
  const countdown = details.locator(".retry-countdown")
  const before = await countdown.textContent()
  await expect(countdown).not.toHaveText(before, { timeout: 2200 })
  assert.match(await countdown.textContent(), /In |Eligible now/)
  const remaining = persisted - Date.now()
  assert(remaining > 0 && remaining <= 90000, "unexpected real retry deadline")
  await expect(countdown).toHaveText("Eligible now · waiting for a worker", {
    timeout: remaining + 2200
  })
  const eligible = (
    await retryLock.query(
      `SELECT state,available_at <= floor(extract(epoch FROM clock_timestamp())*1000) AS due
     FROM "${cfg.schema}".jobs WHERE id=$1`,
      [jobId]
    )
  ).rows[0]
  assert.equal(eligible.state, "RetryScheduled")
  assert.equal(eligible.due, true)
  assert.equal(await details.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press("Escape")
  assert.equal(await details.isVisible(), false)
  // Live reads can reorder the selected row or evict it from this server page.
  // Focus returns to that exact job if present, otherwise to the jobs region.
  const selectedRow = page.locator(".job-list .job-id").filter({ hasText: jobId })
  await expect(
    (await selectedRow.count()) > 0
      ? selectedRow
      : page.getByRole("region", { name: "Jobs list", exact: true })
  ).toBeFocused()
  await selectedRow.click()
  await page.getByRole("button", { name: "Close details", exact: true }).click()
  await expect(selectedRow).toBeFocused()
  await selectedRow.click()
  await retryLock.query("COMMIT")
  retryLock.release()
  retryLock = undefined
  await until(
    async () =>
      (await pool.query(`SELECT state FROM "${cfg.schema}".jobs WHERE id=$1`, [jobId]))
        .rows[0].state === "Completed",
    "real retry did not complete after lock release"
  )
  await expect(
    details
      .locator("dt")
      .filter({ hasText: /^State$/ })
      .locator("..")
      .locator("dd")
  ).toHaveText("Completed")
  await expect(selectedRow).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Jobs list", exact: true })).toBeFocused()
  checks.push(
    "real retry availableAt/timezone/countdown, natural Eligible now and DB due state; worker completion; selected-row Escape/Close focus and evicted-row fallback"
  )
  await page.getByRole("tab", { name: /^All jobs/ }).click()
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await connected()
  const chart = page.getByRole("region", { name: "Job distribution" })
  await chart.scrollIntoViewIfNeeded()
  const svg = chart.locator("svg.recharts-surface")
  await expect(svg).toBeVisible()
  const desktop = await svg.boundingBox()
  assert(desktop.width > 0)
  // Aim inside the ring; a sector's bounding-box center can lie in its hole.
  await page.mouse.move(desktop.x + desktop.width * 0.8, desktop.y + desktop.height * 0.2)
  await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText("jobs ·")
  await page.setViewportSize({ width: 390, height: 844 })
  await until(async () => {
    const box = await svg.boundingBox()
    const panel = await chart.boundingBox()
    return (
      box !== null &&
      panel !== null &&
      box.width > 0 &&
      box.width <= panel.width &&
      panel.width <= 390
    )
  }, "mobile chart did not fit its resized panel")
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  // The chart deliberately caps its ring at 220px; 390px does not necessarily
  // shrink it. A narrower viewport must shrink the actual ResponsiveContainer.
  await page.setViewportSize({ width: 240, height: 844 })
  await until(async () => {
    const box = await svg.boundingBox()
    return box !== null && box.width > 0 && box.width < desktop.width
  }, "narrow SVG did not resize")
  await page.setViewportSize({ width: 390, height: 844 })
  const require = createRequire(resolve("package.json"))
  // CSP disallows injected scripts; evaluate the pinned audit in the automation world.
  await page.evaluate(readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"))
  const violations = await page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
      })
    ).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
  )
  writeFileSync(
    `${evidence}/accessibility.json`,
    JSON.stringify(violations, null, 2) + "\n"
  )
  await page.screenshot({ path: `${evidence}/real-mobile.png`, fullPage: true })
  checks.push(
    "responsive real Recharts SVG and 390px layout; mobile WCAG2/2.1 A/AA audit"
  )
  const previousReads = reads
  const previousSockets = sockets
  await context.setOffline(true)
  await page.evaluate(() => {
    for (const socket of window.qualificationSockets) {
      socket.close(1000, "qualification disconnect")
    }
  })
  await until(async () => websocketEvents.includes("closed"), "real socket did not close")
  await page.waitForTimeout(300)
  await context.setOffline(false)
  await until(async () => reads > previousReads, "reconnect did not reconcile")
  await connected()
  assert(frames > 0 && sockets > previousSockets)
  checks.push(
    "real WebSocket signals and offline/online authoritative HTTP reconciliation"
  )
  // Advance only the app-owned rotation deadline, as in the original Demo gate.
  await pool.query(`UPDATE "${cfg.schema}".demo_control SET rotate_at=0`)
  let rotated
  await until(async () => {
    rotated = await (await dispatch("/api/demo")).json()
    return rotated.ref.sandboxId !== demo.ref.sandboxId
  }, "demo did not rotate")
  await expect(page.locator(".sandbox-scope")).toContainText(rotated.ref.sandboxId)
  await connected()
  await expect(page.locator(".job-list tr")).toHaveCount(5)
  const retiredRead = await dispatch(
    "/api/demo/jobs?" +
      new URLSearchParams({
        sandboxId: demo.ref.sandboxId,
        generation: String(demo.ref.generation),
        limit: "5"
      })
  )
  assert.equal(retiredRead.status, 404)
  checks.push("real demo rotation reconciles new authority and rejects retired requests")
  await page.goto(local.origin + "/jobs")
  await connected()
  const cookie = (await context.cookies()).find(
    (value) => value.name === "__Host-playground"
  )
  assert(cookie?.httpOnly && cookie.secure && cookie.sameSite === "Strict")
  const csrf = (await context.cookies()).find(
    (value) => value.name === "__Host-playground-csrf"
  )
  assert(csrf)
  assert(!(await page.evaluate(() => document.cookie.includes("__Host-playground="))))
  const privateView = await page.evaluate(async () =>
    (
      await fetch("/api/sandbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Playground-CSRF": document.cookie
            .split("; ")
            .find((p) => p.startsWith("__Host-playground-csrf="))
            .split("=")[1]
        }
      })
    ).json()
  )
  const denied = await dispatch(
    `/api/jobs?sandboxId=${privateView.ref.sandboxId}&generation=1&limit=5`
  )
  // Missing credentials deliberately conceal existence. Expired authenticated
  // authority is a separate 401 contract, exercised below by session expiry.
  assert.equal(denied.status, 404)
  assert.deepEqual(await denied.json(), { code: "not-found" })
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await page.getByLabel("Jobs (1–10)").fill("6")
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await page.getByText(/Enqueue acknowledged for/).waitFor()
  await until(
    async () =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.state='Completed'`,
          [privateView.ref.sandboxId]
        )
      ).rows[0].n === 6,
    "real jobs did not complete"
  )
  await page.locator(".job-list .job-id").first().click()
  await details.getByText("Producer identity", { exact: true }).waitFor()
  assert(!/ciphertext|fingerprint|leaseToken/.test(await details.innerText()))
  await until(
    async () =>
      (
        await pool.query(
          `SELECT next_generation_at <= floor(extract(epoch FROM clock_timestamp())*1000) AS ready
     FROM "${cfg.schema}".sandboxes WHERE sandbox_id=$1`,
          [privateView.ref.sandboxId]
        )
      ).rows[0].ready,
    "real reset admission cooldown did not expire"
  )
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await page.locator(".sandbox-scope").filter({ hasText: "generation 2" }).waitFor()
  await expect(page.locator(".job-list tr")).toHaveCount(0)
  assert.equal(await details.isVisible(), false)
  const staleStatus = await page.evaluate(async (ref) => {
    const response = await fetch(
      "/api/jobs?" +
        new URLSearchParams({
          sandboxId: ref.sandboxId,
          generation: String(ref.generation),
          limit: "5"
        })
    )
    return response.status
  }, privateView.ref)
  assert.equal(staleStatus, 409)
  checks.push(
    "private HttpOnly auth and unauthorized read denial; real six-handler completion/detail; generation reset clears authority"
  )
  await pool.query(
    `UPDATE "${cfg.schema}".sandboxes SET expires_at=1 WHERE sandbox_id=$1`,
    [privateView.ref.sandboxId]
  )
  await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await page.getByRole("button", { name: "Recover session", exact: true }).waitFor()
  await page.getByRole("button", { name: "Recover session", exact: true }).click()
  await connected()
  assert.notEqual(
    (await context.cookies()).find((value) => value.name === "__Host-playground").value,
    cookie.value
  )
  checks.push("DB-time session expiry and browser recovery issues new authority")
  assert.deepEqual(errors, [])
  assert.deepEqual(cspErrors, [])
  await context.close()
  await local.mf.dispose()
  local = undefined
  await until(
    async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
        )
      ).rows[0].n === 0,
    "workerd DB sessions leaked",
    5000
  )
  writeFileSync(
    `${evidence}/react-runtime-receipt.json`,
    JSON.stringify(
      {
        result: violations.length ? "FAIL" : "PASS",
        accessibilityViolations: violations,
        checks,
        port: new URL(page.url()).port,
        sockets,
        frames,
        reads,
        browser: browser.version(),
        remainingSessions: 0,
        hosted: "NotTested",
        finishedAt: new Date().toISOString()
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ result: violations.length ? "FAIL" : "PASS", checks }))
  assert.deepEqual(violations, [])
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: `${evidence}/failure.png`, fullPage: true })
      .catch(() => {})
    writeFileSync(
      `${evidence}/failure-diagnostics.json`,
      JSON.stringify(
        {
          errors,
          checks,
          network,
          websocketEvents,
          cspErrorCount: cspErrors.length,
          connection: await page.locator(".connection-status").allTextContents(),
          headings: await page.getByRole("heading").allTextContents()
        },
        null,
        2
      ) + "\n"
    )
  }
  console.error(
    JSON.stringify({
      result: "FAIL",
      checks,
      failureClass: error.constructor.name,
      assertion:
        error.code === "ERR_ASSERTION"
          ? { actual: error.actual, expected: error.expected }
          : undefined,
      frames: String(error.stack)
        .split("\n")
        .filter((line) => line.trim().startsWith("at "))
    })
  )
  process.exitCode = 1
} finally {
  if (retryLock) {
    await retryLock.query("ROLLBACK")
    retryLock.release()
  }
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
}
