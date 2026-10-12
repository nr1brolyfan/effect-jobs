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
const assets = "apps/website/dist"
const output = resolve(`.multica/refresh-dashboard/${baseline ? "before" : "after"}`)
mkdirSync(output, { recursive: true })
const script = readFileSync(`${assets}/Client.js`)
const css = readFileSync(`${assets}/Jobs.css`)
const instant = Date.parse("2026-10-25T00:30:00.123Z")
const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 3600000 }
const jobs = Array.from({ length: 65 }, (_, n) => ({
  ...Fixtures.page.items[0],
  jobId: `synthetic-job-${String(n).padStart(3, "0")}`,
  state: n < 50 ? "Completed" : "Dead",
  updatedAt: instant,
  completedAt: instant
}))
const stats = { ...Fixtures.page.stats, total: 65, Completed: 50, Dead: 15 }
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
  if (url.pathname === "/axe.js") {
    res.setHeader("Content-Type", "text/javascript")
    res.end(readFileSync(require.resolve("axe-core/axe.min.js")))
  } else if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
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
      filteredTotal: sandbox.ref.generation > 1 ? 0 : filtered.length,
      stats:
        sandbox.ref.generation > 1
          ? { ...stats, total: 0, Completed: 0, Dead: 0 }
          : stats,
      items: sandbox.ref.generation > 1 ? [] : filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null
    }
    const failed = fail
    await new Promise((done) => setTimeout(done, delay))
    res.setHeader("Content-Type", "application/json")
    res
      .writeHead(failed ? 503 : 200)
      .end(JSON.stringify(failed ? { code: "unavailable" } : page))
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/demo`)
  await expect(page.locator(".job-list tr")).toHaveCount(20)
  await expect(
    page.locator('.connection-status[data-connection="connected"]')
  ).toBeVisible()
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true })
  const stableFocus = page.getByLabel("Rows per page", { exact: true })
  await stableFocus.focus()
  await page.evaluate(() => {
    window.stableFocus = document.activeElement
    window.stableScroll = scrollY
    window.stableNodes = [
      document.querySelector(".jobs-table"),
      document.querySelector("svg.recharts-surface")
    ]
    window.churn = []
    const record = () =>
      window.churn.push({
        text: document.querySelector(".results-status").textContent,
        connection: document.querySelector(".connection-status").textContent,
        size: document.querySelector(".pagination select").value,
        busy: document
          .querySelector("nav[aria-label=Pagination]")
          .getAttribute("aria-busy"),
        focus: document.activeElement === window.stableFocus,
        scroll: scrollY === window.stableScroll,
        mounted: window.stableNodes.every((n) => n.isConnected),
        announcements: [...document.querySelectorAll("[role=status]")].map(
          (n) => n.textContent
        ),
        disabled: [
          ...document.querySelectorAll(".pagination button, .pagination select")
        ].map((n) => n.disabled)
      })
    window.observer = new MutationObserver(record)
    window.observer.observe(document.querySelector(".dashboard-canvas"), {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
    record()
  })
  delay = 30
  for (let cycle = 0; cycle < 24; cycle++) {
    for (const socket of signals.clients) {
      socket.send(
        JSON.stringify({
          kind: "invalidate",
          sandbox: sandbox.ref,
          reason: "reconcile",
          sequence: cycle + 2
        })
      )
    }
    await page.waitForTimeout(300)
  }
  const afterSignals = requests.length
  await expect
    .poll(() => requests.length, { timeout: 17000 })
    .toBeGreaterThan(afterSignals + 2)
  const churn = await page.evaluate(() => {
    window.observer.disconnect()
    return window.churn
  })
  const beforeNavigation = await page.locator(".results-status").innerText()
  if (!baseline) {
    assert(churn.length > 0)
    assert.equal(
      new Set(churn.map((n) => JSON.stringify(n))).size,
      1,
      "every transient background DOM snapshot must be stable"
    )
    assert(
      churn.every(
        (n) =>
          n.focus &&
          n.scroll &&
          n.mounted &&
          n.connection === "connected" &&
          n.busy === "false"
      )
    )
    checks.push(
      "24 actual WS invalidations plus 3 actual periodic reconciliations; every observed DOM label/control/select/transport/focus/scroll/live region snapshot stable"
    )
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveAttribute(
      "aria-busy",
      "false"
    )
    delay = 650
    const next = page.getByRole("button", { name: "Next page", exact: true })
    await next.focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(80)
    assert.equal(await next.evaluate((n) => n.disabled), false)
    assert.equal(await next.getAttribute("aria-disabled"), "true")
    assert.equal(await next.evaluate((n) => n === document.activeElement), true)
    assert.equal(await page.locator(".query-progress").isVisible(), false)
    assert.equal(
      await page.locator(".results-status p").innerText(),
      `${beforeNavigation} · Previous query`
    )
    await expect(page.locator(".query-progress")).toBeVisible()
    assert.match(await page.locator(".results-status").innerText(), /Page 1/)
    await expect(page.locator(".results-status")).toContainText("Page 2")
    assert.equal(await next.evaluate((n) => n === document.activeElement), true)
    assert.equal(await page.locator(".pagination select").isEnabled(), true)
    const axes = await page
      .locator(".pagination button, .pagination select")
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect()
          return r.y + r.height / 2
        })
      )
    assert(
      Math.max(...axes) - Math.min(...axes) < 2,
      "desktop controls must share one center axis"
    )
    assert.equal(
      await page.getByText("Pages follow known cursors", { exact: false }).count(),
      0
    )
    delay = 0
    await page.getByLabel("State", { exact: true }).selectOption("Completed")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(page.locator(".results-status")).toContainText("50 matching · 3 pages")
    assert.equal(
      await page.getByRole("button", { name: "Page 3", exact: true }).count(),
      0
    )
    await page.getByRole("button", { name: "Page 2", exact: true }).click()
    await expect(page.locator(".results-status")).toContainText("Page 2 ·")
    await page.getByRole("button", { name: "Page 3", exact: true }).click()
    await expect(page.locator(".results-status")).toContainText("Page 3 · 10 results")
    await page.getByRole("button", { name: "First page", exact: true }).click()
    await expect(page.locator(".results-status")).toContainText("Page 1 ·")
    // Capture an old failure at request admission, then supersede with a new query.
    delay = 1100
    fail = true
    const oldCount = requests.length
    await page.getByLabel("State", { exact: true }).selectOption("Dead")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect.poll(() => requests.length).toBeGreaterThan(oldCount)
    delay = 0
    fail = false
    await page.getByLabel("Rows per page", { exact: true }).selectOption("50")
    await expect(page.locator(".job-list tr")).toHaveCount(15)
    await expect(page.locator(".results-status")).toContainText(
      "50 per page · 15 matching · 1 page"
    )
    await page.waitForTimeout(1200)
    assert(!/unavailable/.test(await page.locator(".connection-status").innerText()))
    await expect(page.locator(".job-list tr")).toHaveCount(15)
    checks.push(
      "authoritative filtered50/pageCount3 distinct from navigable neighbors; last visible page works; latest page-size query wins over delayed old failure"
    )
    await page.addScriptTag({ url: "/axe.js" })
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (
            await window.axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
            })
          ).violations
      ),
      []
    )
    checks.push(
      "200ms delayed foreground progress, shown-query label, preserved keyboard focus, enabled page size and aligned desktop controls; axe zero"
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  )
  if (!baseline) {
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (
            await window.axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
            })
          ).violations
      ),
      []
    )
    const bounds = await page.locator(".pagination select").boundingBox()
    assert(bounds.x + bounds.width <= 390)
  }
  assert.deepEqual(errors, [])
  const receipt = {
    baseline,
    result: "PASS",
    source: "synthetic HTTP/WebSocket only; no PostgreSQL",
    browser: browser.version(),
    requests,
    churn,
    distinctChurn: [...new Set(churn.map((n) => JSON.stringify(n)))],
    checks,
    errors,
    hashes: {
      script: createHash("sha256").update(script).digest("hex"),
      css: createHash("sha256").update(css).digest("hex")
    }
  }
  writeFileSync(`${output}/receipt.json`, JSON.stringify(receipt, null, 2))
  console.log(
    JSON.stringify({
      baseline,
      result: receipt.result,
      requests: requests.length,
      distinctChurn: receipt.distinctChurn,
      checks
    })
  )
} finally {
  await browser?.close()
  for (const socket of signals.clients) {
    socket.terminate()
  }
  await new Promise((done) => signals.close(done))
  await new Promise((done) => server.close(done))
}
