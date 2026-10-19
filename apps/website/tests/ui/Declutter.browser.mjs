// Browser FFI against the production bundle with controlled scoped HTTP/WS data.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import * as F from "../../../../packages/playground-contracts/dist/Fixtures.js"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const { WebSocketServer } = createRequire(require.resolve("miniflare"))("ws")
const baseline = process.argv.includes("--before")
const output =
  process.env.DECLUTTER_OUTPUT_DIRECTORY ??
  `.multica/declutter/${baseline ? "before" : "after"}`
const buildDirectory = process.env.DECLUTTER_BUILD_DIRECTORY ?? "apps/website/dist"
mkdirSync(output, { recursive: true })
const script = readFileSync(resolve(buildDirectory, "Client.js"))
const css = readFileSync(resolve(buildDirectory, "Jobs.css"))
const sandbox = {
  ...F.sandbox,
  expiresAt: Date.now() + 3600000,
  capabilities: Object.fromEntries(
    Object.keys(F.sandbox.capabilities).map((k) => [k, true])
  )
}
const states = [
  "Completed",
  "Active",
  "Pending",
  "RetryScheduled",
  "Dead",
  "Isolated",
  "Cancelled"
]
const jobs = Array.from({ length: 77 }, (_, n) => ({
  ...F.page.items[0],
  jobId: `synthetic-job-${String(n).padStart(3, "0")}`,
  state: states[n % 7],
  completedAt: ["Completed", "Dead", "Cancelled"].includes(states[n % 7])
    ? F.page.items[0].completedAt
    : null,
  catalog: { ...F.page.items[0].catalog, kind: n % 2 ? "test.odd" : "test.even" },
  availableAt: Date.now() - 60000
}))
const stats = () => ({
  ...F.page.stats,
  total: jobs.length,
  ...Object.fromEntries(states.map((s) => [s, jobs.filter((j) => j.state === s).length]))
})
let delay = 0,
  fail = false
const requests = [],
  errors = [],
  checks = [],
  heights = {},
  mobileTabs = {}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("js") ? "text/javascript" : "text/css"
    )
    return res.end(url.pathname.endsWith("js") ? script : css)
  }
  if (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/")) {
    res.setHeader("Content-Type", "text/html")
    return res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard qualification</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  }
  res.setHeader("Content-Type", "application/json")
  if (url.pathname === "/api/sandbox" || url.pathname === "/api/sandbox/issue") {
    return res.end(JSON.stringify(sandbox))
  }
  if (url.pathname === "/api/jobs") {
    const q = Object.fromEntries(url.searchParams)
    requests.push(q)
    const filtered = jobs.filter(
      (j) => (!q.state || j.state === q.state) && (!q.kind || j.catalog.kind === q.kind)
    )
    const offset = Number(q.cursor ?? 0),
      limit = Number(q.limit)
    const data = {
      ...F.page,
      sandbox: sandbox.ref,
      stats: stats(),
      filteredTotal: filtered.length,
      items: filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null
    }
    const failed = fail
    await new Promise((r) => setTimeout(r, delay))
    return res
      .writeHead(failed ? 503 : 200)
      .end(JSON.stringify(failed ? { code: "unavailable" } : data))
  }
  if (url.pathname === "/api/jobs/detail") {
    return res.end(
      JSON.stringify({
        ...F.detail,
        sandbox: sandbox.ref,
        job: jobs.find((j) => j.jobId === url.searchParams.get("jobId"))
      })
    )
  }
  res.writeHead(404).end('{"code":"not-found"}')
})
const signals = new WebSocketServer({ server })
let sequence = 1
const signal = (kind) => {
  for (const socket of signals.clients) {
    socket.send(
      JSON.stringify({
        kind,
        sandbox: sandbox.ref,
        reason: "reconcile",
        sequence: sequence++
      })
    )
  }
}
signals.on("connection", () => signal("ready"))
await new Promise((r) => server.listen(0, "127.0.0.1", r))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(6000)
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs`)
  await expect(page.locator(".job-list tr")).toHaveCount(20)
  await expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected"
  )
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator(".state-tabs").scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/${width}.png`, fullPage: true })
    await page.locator(".state-tabs").screenshot({ path: `${output}/${width}-tabs.png` })
    heights[width] = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      tableY: document.querySelector(".jobs-table").getBoundingClientRect().top + scrollY,
      overflow: document.documentElement.scrollWidth > innerWidth,
      headingHeight: document.querySelector(".panel-heading").getBoundingClientRect()
        .height
    }))
  }
  if (!baseline) {
    const result = page.locator(".results-count")
    await expect(result).toHaveText("77 results")
    await expect(page.getByLabel("State", { exact: true })).toHaveCount(0)
    await expect(page.locator(".results-status, .dashboard-footer")).toHaveCount(0)
    assert(
      !/ready-made|Source:|No lifetime quota|Every job, every state|Simulate failures/.test(
        await page.locator("body").innerText()
      )
    )
    const select = async (s) => {
      await page
        .getByRole("tab", {
          name: new RegExp(
            `^${s === "RetryScheduled" ? "Retry scheduled" : s === "all" ? "All jobs" : s}\\b`
          )
        })
        .click()
      await expect(result).toHaveText(s === "all" ? "77 results" : "11 results")
      await expect.poll(() => requests.at(-1)?.state ?? "all").toBe(s)
      if (s !== "all") {
        assert(
          (await page.locator(".job-list tr td:nth-child(3)").allTextContents()).every(
            (t) => t === (s === "RetryScheduled" ? "Retry scheduled" : s)
          )
        )
      }
    }
    for (const s of states) {
      await select(s)
    }
    // Assert actual layout and scrolling: a wrapped fourth row can also receive End.
    const list = page.getByRole("tablist", { name: "Job states" })
    const geometry = await list.evaluate((el) => ({
      wrap: getComputedStyle(el).flexWrap,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      height: el.getBoundingClientRect().height,
      tops: [...el.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.getBoundingClientRect().top
      )
    }))
    console.log(JSON.stringify({ mobileGeometry: geometry }))
    assert.equal(geometry.tops.length, 8)
    assert(
      geometry.tops.every((top) => Math.abs(top - geometry.tops[0]) < 0.5),
      "all eight mobile tabs must occupy one row"
    )
    assert.equal(geometry.wrap, "nowrap")
    assert(
      geometry.scrollWidth > geometry.clientWidth,
      "mobile tabs must overflow horizontally"
    )
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await select("all")
    const all = page.getByRole("tab", { name: /^All jobs/ })
    const cancelled = page.getByRole("tab", { name: /^Cancelled/ })
    await all.focus()
    await list.evaluate((el) => {
      el.scrollLeft = 0
    })
    const prior = requests.length
    const urlBeforeFocus = page.url()
    await page.keyboard.press("End")
    await expect(cancelled).toBeFocused()
    await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    const end = await list.evaluate((el) => {
      const bounds = el.getBoundingClientRect()
      const target = el.querySelector('[role="tab"]:last-child').getBoundingClientRect()
      return {
        scrollLeft: el.scrollLeft,
        visible: target.left >= bounds.left - 0.5 && target.right <= bounds.right + 0.5
      }
    })
    assert(end.visible, "End must reveal Cancelled inside the scrolling list")
    assert.equal(requests.length, prior)
    assert.equal(page.url(), urlBeforeFocus)
    await expect(all).toHaveAttribute("aria-selected", "true")
    await expect(result).toHaveText("77 results")
    await page.keyboard.press("Enter")
    await expect(cancelled).toHaveAttribute("aria-selected", "true")
    await expect(result).toHaveText("11 results")
    await expect.poll(() => requests.at(-1)?.state).toBe("Cancelled")
    assert.equal(new URL(page.url()).searchParams.get("state"), "Cancelled")
    const priorHome = requests.length
    const cancelledUrl = page.url()
    await page.keyboard.press("Home")
    await expect(all).toBeFocused()
    await expect
      .poll(() => list.evaluate((el) => el.scrollLeft))
      .toBeLessThan(end.scrollLeft)
    assert.equal(requests.length, priorHome)
    assert.equal(page.url(), cancelledUrl)
    await expect(cancelled).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Enter")
    await expect(all).toHaveAttribute("aria-selected", "true")
    await expect(result).toHaveText("77 results")
    await expect.poll(() => requests.at(-1)?.state).toBe(undefined)
    assert.equal(new URL(page.url()).searchParams.get("state"), null)
    Object.assign(mobileTabs, {
      geometry,
      end,
      homeScrollLeft: await list.evaluate((el) => el.scrollLeft)
    })
    await select("Isolated")
    await select("all")
    // No removed State form draft can restore the previous tab when applying kind.
    await page.getByLabel("Kind (exact)", { exact: true }).fill("test.even")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(result).toHaveText("39 results")
    await page.getByRole("tab", { name: /^Cancelled/ }).click()
    await expect(result).toHaveText("6 results")
    await page.getByRole("tab", { name: /^All jobs/ }).click()
    await expect(result).toHaveText("39 results")
    await page.getByLabel("Kind (exact)", { exact: true }).fill("")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(result).toHaveText("77 results")
    await page.getByLabel("Search job ID on this page", { exact: true }).fill("000")
    await expect(page.locator(".job-list tr")).toHaveCount(1)
    await expect(result).toHaveText("77 results")
    await page.getByLabel("Search job ID on this page", { exact: true }).fill("")
    await page
      .getByLabel("Due Pending on this page (browser clock)", { exact: true })
      .check()
    assert(
      (await page.locator(".job-list tr td:nth-child(3)").allTextContents()).every(
        (s) => s === "Pending"
      )
    )
    await page
      .getByLabel("Due Pending on this page (browser clock)", { exact: true })
      .uncheck()
    checks.push(
      "all seven status tabs; All clears state; mobile keyboard End/Enter; combined kind; page-local search/due remain distinct from authoritative count"
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    delay = 650
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expect(result).toHaveText("Loading…")
    await expect(page.locator(".job-list tr")).toHaveCount(20)
    await expect(result).toHaveText("77 results")
    assert.equal(await page.locator(".job-id").first().textContent(), "synthetic-job-020")
    await page.getByRole("button", { name: "Previous page", exact: true }).click()
    await expect(result).toHaveText("77 results")
    delay = 0
    await page.getByLabel("Rows per page", { exact: true }).selectOption("50")
    await expect(page.locator(".job-list tr")).toHaveCount(50)
    await expect(result).toHaveText("77 results")
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(27)
    await expect(result).toHaveText("77 results")
    await page.getByRole("button", { name: "Previous page", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(50)
    // A background invalidation keeps stable rows, count, focus and mounted table.
    await page.getByLabel("Rows per page", { exact: true }).focus()
    await page.evaluate(() => {
      window.table = document.querySelector(".jobs-table")
      window.churn = []
      window.observer = new MutationObserver(() =>
        window.churn.push(document.querySelector(".results-count").textContent)
      )
      window.observer.observe(document.querySelector(".jobs-panel"), {
        subtree: true,
        characterData: true,
        childList: true
      })
    })
    delay = 100
    const before = requests.length
    signal("invalidate")
    await expect.poll(() => requests.length).toBeGreaterThan(before)
    await page.waitForTimeout(200)
    assert(
      (
        await page.evaluate(() => {
          window.observer.disconnect()
          return window.churn
        })
      ).every((t) => t === "77 results")
    )
    assert(
      await page.evaluate(() => window.table === document.querySelector(".jobs-table"))
    )
    await expect(page.getByLabel("Rows per page", { exact: true })).toBeFocused()
    jobs.pop()
    signal("invalidate")
    await expect(result).toHaveText("76 results")
    delay = 650
    fail = true
    await page.getByRole("tab", { name: /^Dead/ }).click()
    await expect(result).toHaveText("Loading…")
    await expect(result).toHaveText("Results unavailable")
    fail = false
    delay = 0
    await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
    await expect(result).toHaveText("11 results")
    await page.getByLabel("Kind (exact)", { exact: true }).fill("unknown.kind")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(result).toHaveText("0 results")
    await page.getByLabel("Kind (exact)", { exact: true }).fill("test.even")
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(result).toHaveText("6 results")
    const id = await page.locator(".job-id").first().textContent()
    await page.getByRole("button", { name: id, exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Quick job details", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "Open full details", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await page.goBack()
    await expect(result).toHaveText("6 results")
    await expect(page.getByRole("tab", { name: /^Dead/ })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    await expect(page.getByLabel("Kind (exact)", { exact: true })).toHaveValue(
      "test.even"
    )
    assert.equal(new URL(page.url()).searchParams.get("state"), "Dead")
    if (
      await page.getByRole("button", { name: "Close job details", exact: true }).count()
    ) {
      await page.getByRole("button", { name: "Close job details", exact: true }).click()
    }
    await page.getByRole("tab", { name: /^All jobs/ }).click()
    await page.getByRole("button", { name: "Apply filters", exact: true }).click()
    await expect(result).toHaveText("38 results")
    await expect.poll(() => new URL(page.url()).searchParams.get("state")).toBe(null)
    // Open again after clearing the restored state; Back must retain All jobs.
    await page.locator(".job-id").first().click()
    await page.getByRole("button", { name: "Open full details", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await page.goBack()
    await expect(page.getByRole("tab", { name: /^All jobs/ })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    await expect(result).toHaveText("38 results")
    await page.getByRole("button", { name: "Create jobs", exact: true }).click()
    await expect(page.getByLabel("Fake provider behavior", { exact: true })).toBeFocused()
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true })
    ).toBeEnabled()
    let confirmation = ""
    page.once("dialog", async (d) => {
      confirmation = d.message()
      await d.dismiss()
    })
    await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
    assert.match(confirmation, /Running jobs are not cancelled/)
    checks.push(
      "20/50 rows; next/previous; loading and failed query honesty; live total update; stable background DOM/focus; details Back restores URL/tab/kind; All plus form cannot restore stale status; create/reset safety"
    )
    const beforeHeights = JSON.parse(
      readFileSync(".multica/declutter/before/receipt.json")
    ).heights
    for (const width of [1440, 1024, 390]) {
      assert(!heights[width].overflow)
      assert(heights[width].height <= beforeHeights[width].height)
      assert(heights[width].tableY < beforeHeights[width].tableY)
      assert(heights[width].headingHeight <= beforeHeights[width].headingHeight)
    }
  }
  assert.deepEqual(errors, [])
  writeFileSync(
    `${output}/receipt.json`,
    JSON.stringify(
      {
        result: "PASS",
        baseline,
        heights,
        mobileTabs,
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
  console.log(JSON.stringify({ result: "PASS", baseline, heights, checks }))
} finally {
  await browser?.close()
  for (const socket of signals.clients) {
    socket.terminate()
  }
  await new Promise((r) => signals.close(r))
  await new Promise((r) => server.close(r))
}
