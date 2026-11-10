// Production browser FFI with synthetic HTTP only; never owner/runtime data.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import * as Fixtures from "../../../../packages/playground-contracts/dist/Fixtures.js"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
// Reuse the lockfile-pinned worker test dependency, never install a new package.
const workerRequire = createRequire(require.resolve("miniflare"))
const { WebSocketServer } = workerRequire("ws")
const baseline = process.argv.includes("--before")
const assets = baseline ? ".multica/ux-base/apps/website/dist" : "apps/website/dist"
const output = resolve(`.multica/ux-evidence/${baseline ? "before" : "after"}`)
mkdirSync(output, { recursive: true })
const script = readFileSync(`${assets}/Client.js`)
const css = readFileSync(`${assets}/Jobs.css`)
const instant = Date.parse("2026-10-25T00:30:00.123Z")
const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 3600000 }
const jobs = Array.from({ length: 65 }, (_, n) => ({
  ...Fixtures.page.items[0],
  jobId: `synthetic-job-${String(n).padStart(3, "0")}`,
  state: n < 25 ? "Completed" : "Dead",
  updatedAt: instant,
  completedAt: instant
}))
const stats = { ...Fixtures.page.stats, total: 65, Completed: 25, Dead: 40 }
let delay = 0,
  fail = false,
  revoke = false
const requests = [],
  errors = [],
  checks = []
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'"
  )
  if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("js") ? "text/javascript" : "text/css"
    )
    res.end(url.pathname.endsWith("js") ? script : css)
  } else if (url.pathname === "/api/demo") {
    res.setHeader("Content-Type", "application/json")
    res
      .writeHead(revoke ? 401 : 200)
      .end(JSON.stringify(revoke ? { code: "sandbox-expired" } : sandbox))
  } else if (url.pathname === "/api/demo/jobs") {
    requests.push(Object.fromEntries(url.searchParams))
    const filtered = jobs.filter(
      (j) => !url.searchParams.get("state") || j.state === url.searchParams.get("state")
    )
    const offset = Number(url.searchParams.get("cursor") ?? 0)
    const limit = Number(url.searchParams.get("limit"))
    const page = {
      sandbox: sandbox.ref,
      attentionStats: Fixtures.page.attentionStats,
      filteredTotal: sandbox.ref.generation > 1 ? 0 : filtered.length,
      stats:
        sandbox.ref.generation > 1
          ? { ...stats, total: 0, Completed: 0, Dead: 0 }
          : stats,
      items: sandbox.ref.generation > 1 ? [] : filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null
    }
    await new Promise((done) => setTimeout(done, delay))
    res.setHeader("Content-Type", "application/json")
    res
      .writeHead(fail ? 503 : 200)
      .end(JSON.stringify(fail ? { code: "unavailable" } : page))
  } else if (url.pathname === "/api/demo/jobs/detail") {
    const job = jobs.find((j) => j.jobId === url.searchParams.get("jobId"))
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ...Fixtures.detail, sandbox: sandbox.ref, job }))
  } else if (url.pathname === "/demo") {
    res.setHeader("Content-Type", "text/html")
    res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic UX qualification</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  } else {
    res.writeHead(404).end()
  }
})
const signals = new WebSocketServer({ server })
signals.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      kind: "ready",
      sandbox: sandbox.ref,
      reason: "reconcile",
      sequence: 1
    })
  )
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Warsaw",
    locale: "en-GB"
  })
  const page = await context.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/demo`)
  await expect(
    page.locator('.connection-status[data-connection="connected"]')
  ).toBeVisible()
  await expect(page.locator(".job-list tr")).toHaveCount(baseline ? 5 : 20)
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true })
  if (!baseline) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    assert.equal(
      await page.getByRole("button", { name: "Create jobs", exact: true }).count(),
      0
    )
    assert.equal(await page.locator(".scenario-panel").count(), 0)
    await expect(page.getByRole("tab", { name: "Dead 40", exact: true })).toBeVisible()
    await page.evaluate(() => {
      window.uxNodes = [
        document.querySelector(".jobs-app"),
        document.querySelector(".stats-grid"),
        document.querySelector(".jobs-table"),
        document.querySelector("svg.recharts-surface")
      ]
      window.uxStats = document.querySelector(".stats-grid").textContent
      window.uxMutations = []
      new MutationObserver(() =>
        window.uxMutations.push(document.querySelector(".stats-grid").textContent)
      ).observe(document.querySelector(".stats-grid"), {
        subtree: true,
        childList: true,
        characterData: true
      })
    })
    delay = 1300
    await page.getByRole("tab", { name: "Dead 40", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(page.locator(".results-count")).toHaveText("Loading…")
    await expect(page.locator(".job-list tr").first()).toContainText("Completed")
    const scroll = await page.evaluate(() => scrollY)
    await expect(page.locator(".job-list tr").first()).toContainText("Dead")
    await expect(page.getByRole("tab", { name: "Dead 40", exact: true })).toBeFocused()
    assert.equal(await page.evaluate(() => scrollY), scroll)
    assert(
      await page.evaluate(
        () =>
          window.uxNodes.every((n) => n.isConnected) &&
          window.uxMutations.every((s) => s === window.uxStats)
      )
    )
    checks.push(
      "delayed HTTP filter preserves mounted shell/table/chart, authoritative stats, keyboard focus and scroll; retained rows explicitly announced"
    )
    const pageTwo = page.getByRole("button", { name: "Page 2", exact: true })
    await expect(pageTwo).toBeEnabled()
    await pageTwo.focus()
    await expect(pageTwo).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator(".results-count")).toHaveText("Loading…")
    const pageScroll = await page.evaluate(() => scrollY)
    await expect(page.locator(".job-list .job-id").first()).toHaveText(
      "synthetic-job-045"
    )
    await expect(
      page.getByRole("button", { name: "Page 2", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await expect(pageTwo).toBeEnabled()
    await expect(pageTwo).toBeFocused()
    assert.equal(await page.evaluate(() => scrollY), pageScroll)
    await page.getByRole("button", { name: "Previous page", exact: true }).click()
    await page.getByLabel("Search job ID on this page").focus()
    await expect(page.locator(".job-list .job-id").first()).toHaveText(
      "synthetic-job-025"
    )
    await expect(page.getByLabel("Search job ID on this page")).toBeFocused()
    checks.push(
      "keyboard numbered-page focus and scroll restore after temporary disable; moving focus during loading is respected"
    )
    delay = 0
    await page.getByLabel("Rows per page", { exact: true }).selectOption("50")
    await expect(page.locator(".job-list tr")).toHaveCount(40)
    await expect(
      page.getByRole("button", { name: "Next page", exact: true })
    ).toBeDisabled()
    checks.push(
      "real neighboring cursor history and back navigation; 20/50 resets; global tab counts independent of page"
    )
    await page.getByRole("tab", { name: "All jobs 65", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(50)
    const timestamp = page.locator(".updated-cell button").first()
    await timestamp.focus()
    await page.keyboard.press("Enter")
    const popup = page.getByRole("dialog", { name: "Updated", exact: true })
    await expect(popup).toContainText("Europe/Warsaw")
    await expect(popup).toContainText("00:30:00.123")
    await expect(popup).toContainText("02:30:00.123")
    await expect(popup).toContainText("2026-10-25T00:30:00.123Z")
    await page.keyboard.press("Escape")
    await expect(timestamp).toBeFocused()
    await page.keyboard.press("Space")
    await expect(popup).toBeVisible()
    await page.getByRole("heading", { name: "Background Jobs", exact: true }).click()
    await expect(timestamp).toBeFocused()
    checks.push(
      "shared DateTime actual Base UI popup, exact local/UTC/ISO, Enter/Space/Escape/outside and focus restoration"
    )
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      await page.evaluate(readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"))
      const violations = await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
          })
        ).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
      )
      writeFileSync(`${output}/axe-${width}.json`, JSON.stringify(violations, null, 2))
      assert.deepEqual(violations, [])
    }
    checks.push("desktop/mobile axe zero and no page overflow under production CSP")
    const touch = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      timezoneId: "Europe/Warsaw",
      locale: "en-GB"
    })
    const mobile = await touch.newPage()
    mobile.on("pageerror", (error) => errors.push(error.message))
    await mobile.goto(`http://127.0.0.1:${server.address().port}/demo`)
    await expect(mobile.locator(".job-list tr")).toHaveCount(20)
    const touchTrigger = mobile.locator(".updated-cell button").first()
    await touchTrigger.tap()
    const touchPopup = mobile.getByRole("dialog", { name: "Updated", exact: true })
    await expect(touchPopup).toBeVisible()
    const triggerBox = await touchTrigger.boundingBox()
    const popupBox = await touchPopup.boundingBox()
    assert.equal(
      await touchPopup.getByRole("button", { name: "Close", exact: true }).count(),
      0
    )
    assert(triggerBox.height >= 44)
    assert(popupBox.x >= 0 && popupBox.x + popupBox.width <= 390)
    await mobile.screenshot({ path: `${output}/timestamp-touch.png`, fullPage: false })
    await mobile.getByRole("heading", { name: "Background Jobs", exact: true }).tap()
    await expect(touchPopup).toHaveCount(0)
    await touch.close()
    checks.push(
      "synthesized Chromium touch opens exact timestamp; reachable 44px trigger and popup within 390px viewport"
    )
    delay = 1000
    fail = true
    await page.getByRole("tab", { name: "Dead 40", exact: true }).click()
    await expect(page.locator(".connection-status")).toContainText("unavailable")
    await expect(page.locator(".results-count")).toHaveText("Results unavailable")
    await expect(page.locator(".job-list tr")).toHaveCount(50)
    fail = false
    delay = 0
    await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(40)
    revoke = true
    await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(0)
    await expect(page.locator(".stat-value").first()).toHaveText("—")
    checks.push(
      "failed replacement stays explicitly previous, recovery works; authority expiry clears private-capable rows/stats"
    )
    revoke = false
    await page.goto(`http://127.0.0.1:${server.address().port}/demo`)
    await expect(page.locator(".job-list tr")).toHaveCount(20)
    await page.locator(".job-list .job-id").first().click()
    await expect(
      page.getByRole("dialog", { name: "Quick job details", exact: true })
    ).toContainText("Overview")
    await page.getByRole("button", { name: "Close job details", exact: true }).click()
    delay = 1500
    await page.getByRole("tab", { name: "Dead 40", exact: true }).click()
    await expect(page.locator(".results-count")).toHaveText("Loading…")
    await page.locator(".job-list .job-id").first().click()
    await expect(
      page.getByRole("dialog", { name: "Quick job details", exact: true })
    ).toBeVisible()
    sandbox.ref = { ...sandbox.ref, generation: 2 }
    // Reconciliation races the older server response; no fabricated atom state.
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect(page.locator(".job-list tr")).toHaveCount(0)
    await expect(
      page.getByRole("dialog", { name: "Quick job details", exact: true })
    ).toBeHidden()
    await expect(page.locator(".stat-value").first()).toHaveText("—")
    await expect(page.locator(".stat-value").first()).toHaveText("00")
    await page.waitForTimeout(1700)
    await expect(page.locator(".job-list tr")).toHaveCount(0)
    await expect(page.locator(".stat-value").first()).toHaveText("00")
    checks.push(
      "generation change during delayed old HTTP clears rows/stats/details before replacement; late response cannot restore retired data"
    )
  }
  assert.deepEqual(errors, [])
  assert.equal(await page.locator("style").count(), 0)
  writeFileSync(
    `${output}/receipt.json`,
    JSON.stringify(
      {
        result: "PASS",
        baseline,
        checks,
        requests,
        errors,
        browser: browser.version(),
        hashes: {
          script: createHash("sha256").update(script).digest("hex"),
          css: createHash("sha256").update(css).digest("hex")
        }
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ result: "PASS", baseline, checks }))
} catch (error) {
  writeFileSync(
    `${output}/diagnostics.json`,
    JSON.stringify({ requests, errors, failure: error.message }, null, 2)
  )
  throw error
} finally {
  await browser?.close()
  for (const socket of signals.clients) {
    socket.terminate()
  }
  await new Promise((done) => signals.close(done))
  await new Promise((done) => server.close(done))
}
