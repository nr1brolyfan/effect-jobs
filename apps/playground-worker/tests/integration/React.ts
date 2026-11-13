import type axe from "axe-core"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { Pool, type PoolClient } from "pg"
import { chromium, expect, type Browser, type Page } from "@playwright/test"
import { Schema } from "effect"
import { JobPage } from "@effect-jobs/playground-contracts/Jobs"
import { ScenarioResult } from "@effect-jobs/playground-contracts/Scenarios"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
// Real PG/workerd/Chromium boundary; lifecycle observations come only from API/DB.

const { createLocal } = (await import(
  new URL("./Local.ts", import.meta.url).href
)) as typeof import("./Local.js")

declare global {
  interface Window {
    qualificationSockets: WebSocket[]
    axe: typeof axe
  }
}
const configurationPath = process.env.PLAYGROUND_PRIVATE_CONFIG
const evidencePath = process.env.PLAYGROUND_EVIDENCE_DIRECTORY
assert(configurationPath && evidencePath, "Expected owned qualification paths")
const Configuration = Schema.Struct({
  user: Schema.String,
  database: Schema.String,
  password: Schema.String,
  port: Schema.Int,
  schema: Schema.String,
  encryptionKey: Schema.String,
  fingerprintKey: Schema.String,
  cursorKey: Schema.String
})

const evidence = resolve(evidencePath)
const { migrations } = (await import(`${evidence}/Migrations.mjs`)) as {
  migrations: (schema: string) => ReadonlyArray<{ readonly sql: string }>
}
const cfg = {
  ...Schema.decodeUnknownSync(Configuration)(
    JSON.parse(readFileSync(configurationPath, "utf8"))
  ),
  connectionString: ""
}
const pool = new Pool({ host: "127.0.0.1", ...cfg, connectionTimeoutMillis: 2000 })
const checks: string[] = []
let local: Awaited<ReturnType<typeof createLocal>> | undefined
let browser: Browser | undefined
let page: Page | undefined
let retryLock: PoolClient | undefined
const errors: string[] = []
const cspErrors: string[] = []
const network: Array<{ path: string; status: number }> = []
const websocketEvents: string[] = []
const liveFrames: Array<{
  kind?: unknown
  reason?: unknown
  code?: unknown
  sequence?: unknown
}> = []
const until = async (test: () => Promise<boolean>, label: string, timeout = 30000) => {
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
  local = await createLocal(cfg, { localPrivate: true })
  assert.notEqual(new URL(local.origin).port, "8787")
  const host = local
  const dispatch = (
    path: string,
    options?: Parameters<typeof host.mf.dispatchFetch>[1]
  ) => host.mf.dispatchFetch(host.origin + path, options)
  const guide = await dispatch("/docs/jobs")
  assert.equal(guide.status, 200)
  assert.equal(
    await guide.text(),
    readFileSync("apps/website/dist/site/docs/jobs/index.html", "utf8")
  )
  const css = await (await dispatch("/Jobs.css")).text()
  assert.equal(css, readFileSync("apps/playground/dist/Jobs.css", "utf8"))
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
  const activePage = await context.newPage()
  page = activePage
  // Capture real transports only to inject a socket disconnect later. Messages,
  // authority and lifecycle continue to come from the production server.
  await activePage.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.qualificationSockets = []
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args)
        window.qualificationSockets.push(this)
      }
    }
  })
  activePage.on("pageerror", (error) => errors.push(error.message))
  activePage.on("console", (msg) => {
    if (/content security policy/i.test(msg.text())) {
      cspErrors.push(msg.text())
    }
  })
  let sockets = 0,
    frames = 0,
    reads = 0
  activePage.on("websocket", (socket) => {
    sockets++
    websocketEvents.push("opened")
    socket.on("close", () => websocketEvents.push("closed"))
    socket.on("framereceived", (event) => {
      frames++
      if (typeof event.payload === "string") {
        try {
          const signal = JSON.parse(event.payload) as {
            kind?: unknown
            reason?: unknown
            code?: unknown
            sequence?: unknown
          }
          liveFrames.push({
            kind: signal.kind,
            reason: signal.reason,
            code: signal.code,
            sequence: signal.sequence
          })
        } catch {
          /* Only protocol metadata enters qualification diagnostics. */
        }
      }
    })
  })
  activePage.on("response", (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith("/api/")) {
      network.push({ path, status: response.status() })
    }
  })
  activePage.on("request", (req) => {
    if (/\/api\/(demo\/)?jobs\?/.test(req.url())) {
      reads++
    }
  })
  const connected = () =>
    activePage.locator('.connection-status[data-connection="connected"]').waitFor()
  // The native generator publishes through durable callbacks after HTTP startup.
  // Await application readiness before exercising browser hydration oracles.
  await until(
    async () => (await dispatch("/api/demo")).status === 200,
    "native demo readiness"
  )
  const firstPageResponse = activePage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/demo/jobs" && response.status() === 200
  )
  await activePage.goto(local.origin + "/demo")
  const renderedFirst = Schema.decodeUnknownSync(JobPage)(
    await (await firstPageResponse).json()
  )
  await connected()
  await expect(activePage.locator(".job-list tr")).toHaveCount(20)
  // Read-only demo omits mutation launchers; server authority is still tested below.
  for (const name of ["Create jobs", "Run scenario", "Reset my sandbox"]) {
    await expect(activePage.getByRole("button", { name, exact: true })).toHaveCount(0)
  }
  const deniedDemoWrite = await dispatch("/api/demo/scenarios", { method: "POST" })
  assert.equal(deniedDemoWrite.status, 404)
  assert.deepEqual(await deniedDemoWrite.json(), { code: "not-found" })
  const demo = Schema.decodeUnknownSync(SandboxView)(
    await (await dispatch("/api/demo")).json()
  )
  const list = async (extra: Record<string, string> = {}) => {
    const response = await dispatch(
      "/api/demo/jobs?" +
        new URLSearchParams({
          sandboxId: demo.ref.sandboxId,
          generation: String(demo.ref.generation),
          limit: "20",
          ...extra
        })
    )
    assert.equal(response.status, 200)
    return Schema.decodeUnknownSync(JobPage)(await response.json())
  }
  const first = await list()
  assert(first.nextCursor)
  const next = await list({ cursor: first.nextCursor })
  const visibleIds = () => activePage.locator(".job-list .job-id").allTextContents()
  assert.equal(renderedFirst.items.length, 20)
  await expect.poll(visibleIds).toEqual(renderedFirst.items.map((item) => item.jobId))
  assert(renderedFirst.nextCursor)
  const nextPageResponse = activePage.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/demo/jobs" &&
      url.searchParams.get("cursor") === renderedFirst.nextCursor
    )
  })
  await activePage.getByRole("button", { name: "Next page", exact: true }).click()
  const renderedNext = Schema.decodeUnknownSync(JobPage)(
    await (await nextPageResponse).json()
  )
  assert(
    !renderedFirst.items.some((a) => renderedNext.items.some((b) => a.jobId === b.jobId))
  )
  await expect.poll(visibleIds).toEqual(renderedNext.items.map((item) => item.jobId))
  await activePage.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(activePage.locator(".job-list tr")).toHaveCount(20)
  checks.push(
    "default 20-row page identities and exact server next-cursor page; previous page returns"
  )
  assert(!first.items.some((a) => next.items.some((b) => a.jobId === b.jobId)))
  const dead = await list({ state: "Dead", limit: "1" })
  assert.equal(dead.items.length, 1)
  assert.equal(dead.items[0]!.state, "Dead")
  assert(dead.stats.total >= 30 && dead.stats.Dead >= 6)
  checks.push(
    "demo write denial, real server cursor/filter, global statistics independent of filtered page"
  )
  await activePage.getByRole("tab", { name: /^Retry scheduled/ }).click()
  await expect(activePage.locator(".job-list .status-cell").first()).toHaveText(
    "Retry scheduled"
  )
  await activePage.locator(".job-list .job-id").first().click()
  const details = activePage.getByRole("dialog", {
    name: "Quick job details",
    exact: true
  })
  await details
    .locator("summary")
    .filter({ hasText: "Identity & execution policy" })
    .click()
  await details.getByText("Retry delay", { exact: true }).waitFor()
  const retryTime = details.getByRole("button", { name: /^Available:/ }).locator("time")
  const persisted = Date.parse((await retryTime.getAttribute("datetime"))!)
  assert(Number.isFinite(persisted))
  const jobId = (await details
    .locator("dt")
    .filter({ hasText: /^Job$/ })
    .locator("..")
    .locator("dd")
    .textContent())!.trim()
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
  // DateTime owns local presentation; persisted availability remains DB authority.
  await details.getByRole("button", { name: /^Available:/ }).click()
  const timestamp = activePage.getByRole("dialog", { name: "Available", exact: true })
  await expect(timestamp).toContainText(new Date(persisted).toISOString())
  await activePage.keyboard.press("Escape")
  const remaining = persisted - Date.now()
  assert(remaining > 0 && remaining <= 90000, "unexpected real retry deadline")
  await until(
    async () => Date.now() >= persisted,
    "real retry deadline did not elapse",
    remaining + 2200
  )
  const eligible = (
    await retryLock.query(
      `SELECT state,available_at <= floor(extract(epoch FROM clock_timestamp())*1000) AS due
     FROM "${cfg.schema}".jobs WHERE id=$1`,
      [jobId]
    )
  ).rows[0]
  assert.equal(eligible.state, "RetryScheduled")
  assert.equal(eligible.due, true)
  await expect(details.getByRole("button", { name: /^Available:/ })).toBeFocused()
  await activePage.keyboard.press("Escape")
  assert.equal(await details.isVisible(), false)
  // Live reads can reorder the selected row or evict it from this server activePage.
  // Focus returns to that exact job if present, otherwise to the jobs region.
  const selectedRow = activePage.locator(".job-list .job-id").filter({ hasText: jobId })
  await expect(
    (await selectedRow.count()) > 0
      ? selectedRow
      : activePage.getByRole("region", { name: "Jobs list", exact: true })
  ).toBeFocused()
  await selectedRow.click()
  await activePage.getByRole("button", { name: "Close job details", exact: true }).click()
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
  await expect(details.getByLabel("Job overview")).toContainText("Completed")
  await expect(selectedRow).toHaveCount(0)
  await activePage.keyboard.press("Escape")
  const fallbackList = activePage.getByRole("region", { name: "Jobs list", exact: true })
  await expect(fallbackList.getByRole("tab", { selected: true })).toBeFocused()
  assert(await fallbackList.evaluate((node) => node.contains(document.activeElement)))
  checks.push(
    "real retry availableAt/local DateTime ISO, natural DB deadline and due state; worker completion; selected-row Escape/Close focus and evicted-row fallback"
  )
  await activePage.getByRole("tab", { name: /^All jobs/ }).click()
  await connected()
  const chart = activePage.getByRole("region", { name: "Job distribution" })
  await chart.scrollIntoViewIfNeeded()
  const svg = chart.locator("svg.recharts-surface")
  await expect(svg).toBeVisible()
  const desktop = await svg.boundingBox()
  assert(desktop)
  assert(desktop.width > 0)
  // Aim inside the ring; a sector's bounding-box center can lie in its hole.
  await activePage.mouse.move(
    desktop.x + desktop.width * 0.8,
    desktop.y + desktop.height * 0.2
  )
  await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText("jobs ·")
  await activePage.setViewportSize({ width: 390, height: 844 })
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
  assert(
    await activePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  )
  // The chart deliberately caps its ring at 220px; 390px does not necessarily
  // shrink it. A narrower viewport must shrink the actual ResponsiveContainer.
  await activePage.setViewportSize({ width: 240, height: 844 })
  await until(async () => {
    const box = await svg.boundingBox()
    return box !== null && box.width > 0 && box.width < desktop.width
  }, "narrow SVG did not resize")
  await activePage.setViewportSize({ width: 390, height: 844 })
  const require = createRequire(resolve("package.json"))
  // CSP disallows injected scripts; evaluate the pinned audit in the automation world.
  await activePage.evaluate(readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"))
  const violations = await activePage.evaluate(async () =>
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
  await activePage.screenshot({ path: `${evidence}/real-mobile.png`, fullPage: true })
  checks.push(
    "responsive real Recharts SVG and 390px layout; mobile WCAG2/2.1 A/AA audit"
  )
  const previousReads = reads
  const previousSockets = sockets
  await activePage.evaluate(() => {
    for (const socket of window.qualificationSockets) {
      socket.close(1000, "qualification disconnect")
    }
  })
  await until(async () => websocketEvents.includes("closed"), "real socket did not close")
  await context.setOffline(true)
  await activePage.waitForTimeout(300)
  await context.setOffline(false)
  await until(async () => reads > previousReads, "reconnect did not reconcile")
  await connected()
  assert(frames > 0 && sockets > previousSockets)
  checks.push(
    "real WebSocket signals and offline/online authoritative HTTP reconciliation"
  )
  // Advance only the app-owned rotation deadline, as in the original Demo gate.
  await pool.query(`UPDATE "${cfg.schema}".demo_control SET rotate_at=0`)
  let rotated: SandboxView | undefined
  await until(async () => {
    const response = await dispatch("/api/demo")
    if (response.status === 503) {
      return false
    }
    assert.equal(response.status, 200)
    rotated = Schema.decodeUnknownSync(SandboxView)(await response.json())
    return rotated.ref.sandboxId !== demo.ref.sandboxId
  }, "demo did not rotate")
  assert(rotated)
  await expect(activePage.locator(".sandbox-scope")).toContainText(rotated.ref.sandboxId)
  await connected()
  await expect(activePage.locator(".job-list tr")).toHaveCount(20)
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
  await activePage.goto(local.origin + "/jobs")
  await connected()
  const cookie = (await context.cookies()).find(
    (value) => value.name === Cookies.names(local!.origin, true).credential
  )
  assert(cookie?.httpOnly && !cookie.secure && cookie.sameSite === "Strict")
  const csrf = (await context.cookies()).find(
    (value) => value.name === Cookies.names(local!.origin, true).csrf
  )
  assert(csrf)
  assert(
    !(await activePage.evaluate(
      (name) => document.cookie.includes(name + "="),
      Cookies.names(local.origin, true).credential
    ))
  )
  const privateView = Schema.decodeUnknownSync(SandboxView)(
    await activePage.evaluate(
      async (csrfName) =>
        (
          await fetch("/api/sandbox", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Playground-CSRF": document.cookie
                .split("; ")
                .find((p) => p.startsWith(csrfName + "="))!
                .split("=")[1]!
            }
          })
        ).json(),
      Cookies.names(local.origin, true).csrf
    )
  )
  const denied = await dispatch(
    `/api/jobs?sandboxId=${privateView.ref.sandboxId}&generation=1&limit=5`
  )
  // Missing credentials deliberately conceal existence. Expired authenticated
  // authority is a separate 401 contract, exercised below by session expiry.
  assert.equal(denied.status, 404)
  assert.deepEqual(await denied.json(), { code: "not-found" })
  await activePage.getByRole("button", { name: "Create jobs", exact: true }).click()
  await activePage.getByLabel("Jobs (1–10)").fill("6")
  const admittedResponse = activePage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/scenarios" &&
      response.request().method() === "POST"
  )
  await activePage.getByRole("button", { name: "Run scenario", exact: true }).click()
  const admitted = Schema.decodeUnknownSync(ScenarioResult)(
    await (await admittedResponse).json()
  )
  assert(admitted._tag === "Committed")
  assert.equal(admitted.jobIds.length, 6)
  assert.equal(new Set(admitted.jobIds).size, 6)
  await activePage.getByText(/Enqueue acknowledged for/).waitFor()
  await until(
    async () =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "${cfg.schema}".jobs j JOIN "${cfg.schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.id=ANY($2::text[]) AND j.state='Completed'`,
          [privateView.ref.sandboxId, admitted.jobIds]
        )
      ).rows[0].n === 6,
    "real jobs did not complete"
  )
  await activePage
    .locator(".job-list tr")
    .filter({ hasText: "Welcome Email" })
    .first()
    .locator(".job-id")
    .click()
  await details
    .locator("summary")
    .filter({ hasText: "Identity & execution policy" })
    .click()
  await details.getByText("Producer operation", { exact: true }).waitFor()
  assert(!/ciphertext|fingerprint|leaseToken/.test(await details.innerText()))
  await details.getByRole("button", { name: "Close job details", exact: true }).click()
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
  activePage.once("dialog", (dialog) => dialog.accept())
  await activePage.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await activePage.locator(".sandbox-scope").filter({ hasText: "generation 2" }).waitFor()
  await expect(activePage.locator(".job-list tr")).toHaveCount(6)
  assert.equal(await details.isVisible(), false)
  const staleStatus = await activePage.evaluate(async (ref) => {
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
  await activePage.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await activePage.getByRole("button", { name: "Recover session", exact: true }).waitFor()
  await activePage.getByRole("button", { name: "Recover session", exact: true }).click()
  await connected()
  const renewedCookie = (await context.cookies()).find(
    (value) => value.name === Cookies.names(local!.origin, true).credential
  )
  assert(renewedCookie)
  assert.notEqual(renewedCookie.value, cookie.value)
  checks.push("DB-time session expiry and browser recovery issues new authority")
  assert.deepEqual(errors, [])
  assert.deepEqual(cspErrors, [])
  await context.close()
  await local.mf.dispose()
  local = undefined
  local = await createLocal(cfg, { https: false, localPrivate: true })
  const previewResult = await promisify(execFile)(
    process.execPath,
    ["apps/website/tests/ui/PreviewSession.ts"],
    {
      env: { ...process.env, PLAYGROUND_PREVIEW_ORIGIN: local.origin },
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    }
  )
  writeFileSync(
    `${evidence}/http-preview.log`,
    previewResult.stdout + previewResult.stderr
  )
  await local.mf.dispose()
  local = undefined
  checks.push(
    "owned HTTP preview: port-scoped HttpOnly session, valid reload, stale-token recovery and real scenario completion"
  )
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
        port: new URL(activePage.url()).port,
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
          liveFrames,
          cspErrorCount: cspErrors.length,
          connection: await page.locator(".connection-status").allTextContents(),
          headings: await page.getByRole("heading").allTextContents(),
          focus: await page.evaluate(() => ({
            tag: document.activeElement?.tagName,
            label: document.activeElement?.getAttribute("aria-label"),
            text: document.activeElement?.textContent?.slice(0, 100)
          }))
        },
        null,
        2
      ) + "\n"
    )
  }
  const failure = error as Error & { code?: string; actual?: unknown; expected?: unknown }
  console.error(
    JSON.stringify({
      result: "FAIL",
      checks,
      failureClass: failure.constructor.name,
      assertion:
        failure.code === "ERR_ASSERTION"
          ? { actual: failure.actual, expected: failure.expected }
          : undefined,
      frames: String(failure.stack)
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
