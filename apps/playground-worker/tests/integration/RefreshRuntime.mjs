// Foreground, disposable PG/workerd/browser qualification of the refresh integration.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"
const evidence = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const { seed } = await import(`${evidence}/RefreshSeed.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({ host: "127.0.0.1", ...cfg, connectionTimeoutMillis: 2000 })
const requestedQueries = []
const checks = [],
  observations = [],
  network = [],
  errors = [],
  cspErrors = []
let local,
  browser,
  page,
  sockets = 0,
  frames = 0,
  reads = 0
const table = (name) => `"${cfg.schema}"."${name}"`
const status = () => page.locator(".results-count")
const connected = () =>
  expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected"
  )
const query = async (extra = {}) =>
  page.evaluate(async (extra) => {
    const response = await fetch("/api/jobs?" + new URLSearchParams(extra))
    return { status: response.status, body: await response.json() }
  }, extra)
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
  local = await createLocal(cfg, { port: 18874 })
  const dispatch = (path) => local.mf.dispatchFetch(local.origin + path)
  assert.equal(
    await (await dispatch("/Jobs.css")).text(),
    readFileSync("apps/website/dist/Jobs.css", "utf8")
  )
  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors"]
  })
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Warsaw"
  })
  page = await context.newPage()
  await page.addInitScript(() => {
    const Native = window.WebSocket
    window.qualificationSockets = []
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args)
        window.qualificationSockets.push(this)
      }
    }
  })
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) {
      cspErrors.push(m.text())
    }
  })
  page.on("websocket", (ws) => {
    sockets++
    ws.on("framereceived", () => frames++)
  })
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) {
      network.push({ path: new URL(r.url()).pathname, status: r.status() })
    }
  })
  page.on("request", (r) => {
    if (/\/api\/jobs\?/.test(r.url())) {
      reads++
      requestedQueries.push(Object.fromEntries(new URL(r.url()).searchParams))
    }
  })
  await page.goto(local.origin + "/jobs")
  await connected()
  const view = await page.evaluate(async () =>
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
  const ref = view.ref
  // Freeze only this disposable sandbox's app-owned generation schedule. Existing
  // auto-job associations are removed before the finite controlled membership fixture.
  await pool.query(
    `UPDATE ${table("sandboxes")} SET next_generation_at=9000000000000 WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  await pool.query(`DELETE FROM ${table("provider_ledger")} WHERE sandbox_id=$1`, [
    ref.sandboxId
  ])
  await pool.query(`DELETE FROM ${table("associations")} WHERE sandbox_id=$1`, [
    ref.sandboxId
  ])
  await pool.query(
    `UPDATE ${table("sandboxes")} SET retained_jobs=0 WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  const ids = await Effect.runPromise(seed(cfg, ref, 51))
  await Effect.runPromise(seed(cfg, ref, 5, 1))
  const arrival = ids[0]
  await pool.query(`DELETE FROM ${table("associations")} WHERE job_id=$1`, [arrival])
  const foreign = { sandboxId: "refresh-foreign", generation: 1 }
  await pool.query(
    `INSERT INTO ${table("sandboxes")}(sandbox_id,generation,expires_at,credential_hash,next_generation_at) VALUES($1,1,9000000000000,'synthetic-foreign',9000000000000)`,
    [foreign.sandboxId]
  )
  await Effect.runPromise(seed(cfg, foreign, 4))
  const params = {
    sandboxId: ref.sandboxId,
    generation: String(ref.generation),
    limit: "20",
    state: "Pending",
    kind: "playground.welcome-email"
  }
  const first = await query(params)
  assert.equal(first.status, 200)
  assert.equal(first.body.filteredTotal, 50)
  assert.equal(first.body.items.length, 20)
  assert.equal(first.body.stats.total, 55)
  const second = await query({ ...params, cursor: first.body.nextCursor })
  const third = await query({ ...params, cursor: second.body.nextCursor })
  assert.equal(second.body.filteredTotal, 50)
  assert.equal(third.body.filteredTotal, 50)
  assert.equal(second.body.items.length, 20)
  assert.equal(third.body.items.length, 10)
  assert.equal(
    new Set(
      [...first.body.items, ...second.body.items, ...third.body.items].map((j) => j.jobId)
    ).size,
    50
  )
  const unfiltered = await query({
    sandboxId: ref.sandboxId,
    generation: "1",
    limit: "50"
  })
  assert.equal(unfiltered.body.filteredTotal, 55)
  const foreignRead = await query({ ...params, sandboxId: foreign.sandboxId })
  assert.equal(foreignRead.status, 404)
  await page.getByRole("tab", { name: /^Pending/ }).click()
  await page.getByLabel("Kind (exact)", { exact: true }).fill("playground.welcome-email")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await expect(status()).toContainText("50 results")
  await expect(page.locator(".job-list tr")).toHaveCount(20)
  assert.equal(await page.getByRole("button", { name: "Page 3", exact: true }).count(), 0)
  await page.screenshot({ path: `${evidence}/real-desktop.png`, fullPage: true })
  checks.push(
    "PG16.15 scoped same-snapshot count 50 vs global55/foreign4; signed 20/20/10 disjoint cursor pages; live count3 without fabricated page3"
  )

  let delayReads = true
  await page.route("**/api/jobs?*", async (route) => {
    const response = await route.fetch()
    if (delayReads) {
      await new Promise((done) => setTimeout(done, 350))
    }
    await route.fulfill({ response })
  })
  const size = page.getByLabel("Rows per page", { exact: true })
  await size.focus()
  await page.evaluate(() => {
    window.refreshFocus = document.activeElement
    window.refreshScroll = scrollY
    window.refreshNodes = [
      document.querySelector(".jobs-app"),
      document.querySelector(".jobs-table"),
      document.querySelector("svg.recharts-surface")
    ]
    window.refreshObserved = []
    const record = () =>
      window.refreshObserved.push({
        label: document.querySelector(".results-count").textContent,
        connection: document.querySelector(".connection-status").textContent,
        controls: [
          ...document.querySelectorAll(".pagination button,.pagination select")
        ].map((n) => [
          n.disabled,
          n.getAttribute("aria-disabled"),
          n.getAttribute("aria-current")
        ]),
        size: document.querySelector(".pagination select").value,
        busy: document
          .querySelector("nav[aria-label=Pagination]")
          .getAttribute("aria-busy"),
        focus: document.activeElement === window.refreshFocus,
        scroll: scrollY === window.refreshScroll,
        mounted: window.refreshNodes.every((n) => n.isConnected),
        announcements: [...document.querySelectorAll("[role=status]")].map(
          (n) => n.textContent
        )
      })
    window.refreshObserver = new MutationObserver(record)
    window.refreshObserver.observe(document.querySelector(".jobs-app"), {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true
    })
    record()
  })
  const startReads = reads,
    startFrames = frames,
    startSockets = sockets
  // Actual server alarm signals plus independent browser periodic reads. Delayed
  // deliveries exercise intermediate DOM commits, not merely final screenshots.
  await expect.poll(() => reads, { timeout: 55000 }).toBeGreaterThan(startReads + 15)
  const stable = await page.evaluate(() => {
    window.refreshObserver.disconnect()
    return window.refreshObserved
  })
  observations.push(...stable)
  assert(stable.length > 1)
  assert.equal(
    new Set(stable.map((n) => JSON.stringify(n))).size,
    1,
    "transient background DOM churn"
  )
  assert(
    stable.every(
      (n) =>
        n.focus &&
        n.scroll &&
        n.mounted &&
        n.connection === "connected" &&
        n.busy === "false"
    )
  )
  assert(frames > startFrames + 5 && sockets === startSockets)
  checks.push(
    "16 real delayed background reads across repeated server WS alarm signals/browser polls; all transient labels/progress/controls/select/transport/focus/scroll/live announcements stable"
  )

  const page2 = page.getByRole("button", { name: "Page 2", exact: true })
  await page2.focus()
  await page.keyboard.press("Enter")
  await expect(status()).toHaveText("Loading…")
  assert.equal(await page2.evaluate((n) => n.disabled), false)
  await expect(page2).toBeFocused()
  await expect(page.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(page2).toBeFocused()
  await expect(page2).toHaveAttribute("aria-current", "page")
  const last = page.getByRole("button", { name: "Page 3", exact: true })
  await last.click()
  await expect(page.locator(".job-list tr")).toHaveCount(10)
  await page.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(page.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  delayReads = false
  await pool.query(`INSERT INTO ${table("associations")} VALUES($1,1,$2,'{}'::jsonb)`, [
    ref.sandboxId,
    arrival
  ])
  await expect(status()).toContainText("51 results", { timeout: 12000 })
  assert(!(await page.locator(".job-list .job-id").filter({ hasText: arrival }).count()))
  await page.getByRole("button", { name: "First page", exact: true }).click()
  await expect(page.locator(".job-list .job-id").first()).toHaveText(arrival)
  await size.selectOption("50")
  await expect(status()).toContainText("51 results")
  await expect(page.locator(".job-list tr")).toHaveCount(50)
  await page.getByRole("button", { name: "Page 2", exact: true }).click()
  await expect(page.locator(".job-list tr")).toHaveCount(1)
  const beforeShrink = requestedQueries.length
  // Membership removal is app-owned SQL; never manufacture lifecycle outcomes.
  await pool.query(
    `DELETE FROM ${table("associations")} WHERE sandbox_id=$1 AND job_id=ANY($2::text[])`,
    [ref.sandboxId, ids.slice(5)]
  )
  await expect(page.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(status()).toContainText("5 results")
  const shrinkQueries = requestedQueries.slice(beforeShrink)
  assert.equal(
    shrinkQueries.filter((q) => !q.cursor).length,
    1,
    "exactly one first-page recovery"
  )
  assert(shrinkQueries.at(-2).cursor && !shrinkQueries.at(-1).cursor)
  await pool.query(
    `DELETE FROM ${table("associations")} WHERE sandbox_id=$1 AND job_id=ANY($2::text[])`,
    [ref.sandboxId, ids.slice(0, 5)]
  )
  await expect(status()).toContainText("0 results")
  await expect(page.locator(".job-list tr")).toHaveCount(0)
  assert.equal((await query(params)).body.stats.total, 5)
  checks.push(
    "latest visible numbered neighbor works; pre-anchor arrival live count51, first reveals it; 20/50 count; page2 shrink normalizes atomically to5/first and empty0 with independent global5"
  )

  await page
    .getByLabel("Kind (exact)", { exact: true })
    .fill("playground.image-processing")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await expect(page.locator(".job-list tr")).toHaveCount(5)
  const timestamp = page.locator(".updated-cell button").first()
  await timestamp.focus()
  await page.keyboard.press("Enter")
  const popup = page.getByRole("dialog", { name: "Updated", exact: true })
  await expect(popup).toContainText("Europe/Warsaw")
  assert.equal(await popup.getByRole("button", { name: "Close", exact: true }).count(), 0)
  const dt = await timestamp.locator("time").getAttribute("datetime")
  await expect(popup).toContainText(dt)
  await page.keyboard.press("Escape")
  await expect(timestamp).toBeFocused()
  await page.keyboard.press("Space")
  await expect(popup).toBeVisible()
  await page.getByRole("heading", { name: "Background Jobs", exact: true }).click()
  await expect(popup).toHaveCount(0)
  await expect(timestamp).toBeFocused()
  const align = await timestamp.evaluate((n) => ({
    button: n.getBoundingClientRect().x,
    time: n.querySelector("time").getBoundingClientRect().x,
    cell: n.closest("td").getBoundingClientRect().x
  }))
  assert(Math.abs(align.button - align.time) < 2 && align.button - align.cell < 16)
  const require = createRequire(resolve("package.json"))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.evaluate(readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"))
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
    )
    writeFileSync(`${evidence}/axe-${width}.json`, JSON.stringify(violations, null, 2))
    assert.deepEqual(violations, [])
    await page.screenshot({ path: `${evidence}/real-final-${width}.png`, fullPage: true })
  }
  checks.push(
    "actual compiled timestamp left alignment, ISO/local popover, Enter/Space/Escape/outside/focus without Close; desktop/mobile axe0/CSP/no overflow"
  )
  const beforeDisconnect = sockets
  await context.setOffline(true)
  await page.evaluate(() => {
    for (const ws of window.qualificationSockets) {
      ws.close(1000, "qualification disconnect")
    }
  })
  await expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "reconnecting"
  )
  await context.setOffline(false)
  await connected()
  assert(sockets > beforeDisconnect)
  checks.push(
    "real transport disconnect displays reconnecting and admitted new WS restores connected"
  )
  // Generation and auth are real persisted authority changes, with no fabricated rows.
  await pool.query(
    `UPDATE ${table("sandboxes")} SET generation=generation+1 WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  await expect(page.locator(".job-list tr")).toHaveCount(0)
  assert.equal((await query(params)).status, 409)
  await pool.query(`UPDATE ${table("sandboxes")} SET expires_at=1 WHERE sandbox_id=$1`, [
    ref.sandboxId
  ])
  await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Recover session", exact: true })
  ).toBeVisible()
  await expect(page.locator(".job-list tr")).toHaveCount(0)
  assert.equal((await query(params)).status, 401)
  checks.push("real generation fencing409 and DB-time auth expiry401 clear retained rows")
  assert.deepEqual(errors, [])
  assert.deepEqual(cspErrors, [])
  await context.close()
  await local.mf.dispose()
  local = undefined
  await expect
    .poll(
      async () =>
        Number(
          (
            await pool.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
            )
          ).rows[0].n
        ),
      { timeout: 8000 }
    )
    .toBe(0)
  writeFileSync(
    `${evidence}/refresh-runtime-receipt.json`,
    JSON.stringify(
      {
        result: "PASS",
        checks,
        observations,
        network,
        requestedQueries,
        sockets,
        frames,
        reads,
        browser: browser.version(),
        port: 18874,
        remainingSessions: 0,
        finishedAt: new Date().toISOString()
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ result: "PASS", checks, sockets, frames, reads }))
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: `${evidence}/failure.png`, fullPage: true })
      .catch(() => {})
  }
  writeFileSync(
    `${evidence}/failure-diagnostics.json`,
    JSON.stringify(
      { checks, network, errors, cspErrors, observations, failure: error.message },
      null,
      2
    )
  )
  console.error(
    JSON.stringify({
      result: "FAIL",
      checks,
      failure: error.message,
      stack: String(error.stack)
        .split("\n")
        .filter((s) => s.trim().startsWith("at "))
    })
  )
  process.exitCode = 1
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
}
