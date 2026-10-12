import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

// Task-local Playwright install, leaving all shared manifests/locks untouched.
const require = createRequire(
  resolve(process.env.UI_PLAYWRIGHT_PACKAGE ?? ".multica/browser/package.json")
)
const { chromium } = require("playwright")
const output = resolve(".multica/ui-browser")
await mkdir(output, { recursive: true })
execFileSync("bun", ["apps/website/build.mjs", "--fixtures"], {
  stdio: "inherit",
  timeout: 600_000,
  env: { ...process.env, UI_BUILD_DIRECTORY: output }
})
const css = await readFile(resolve(output, "Jobs.css"))
const html = await readFile("apps/website/src/features/jobs/Fixture.html", "utf8")
const guide = await readFile("apps/website/content/docs/Jobs.html")
const scripts = {
  "/FixtureEntry.js": await readFile(resolve(output, "FixtureEntry.js")),
  "/BrowserEntry.js": await readFile(resolve(output, "BrowserEntry.js"))
}
const server = createServer((req, res) => {
  if (req.url === "/Jobs.css") {
    res.setHeader("content-type", "text/css")
    res.end(css)
  } else if (Object.hasOwn(scripts, req.url ?? "")) {
    res.setHeader("content-type", "text/javascript")
    res.end(scripts[req.url])
  } else if (req.url === "/docs/jobs") {
    res.setHeader("content-type", "text/html")
    res.end(guide)
  } else if (["/jobs", "/commands", "/fixture", "/poll"].includes(req.url)) {
    res.setHeader("content-type", "text/html")
    res.end(
      req.url === "/fixture" ? html : html.replace("/FixtureEntry.js", "/BrowserEntry.js")
    )
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolveListening) => server.listen(0, "127.0.0.1", resolveListening))
const url = `http://127.0.0.1:${server.address().port}`
let browser
const checks = []
const errors = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH === undefined
      ? {}
      : { executablePath: process.env.UI_CHROMIUM_PATH })
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  const text = async (locator, expected) => {
    await locator.filter({ hasText: expected }).first().waitFor({ timeout: 10_000 })
  }
  const status = () => page.getByRole("status").first()
  const rows = () => page.locator(".job-list tr")
  const read = () => page.evaluate(() => window.jobsBrowserTest.reconcile())
  const accessibility = async () => {
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target)
      }))
    )
    assert.deepEqual(violations, [])
  }
  await page.goto(`${url}/jobs`)
  await text(status(), "connected")
  assert.equal(await rows().count(), 5)
  assert.equal(
    await page.getByRole("heading", { name: "Background Jobs", exact: true }).count(),
    1
  )
  assert.equal(await page.getByRole("table", { name: "Background jobs" }).count(), 1)
  assert.equal(await page.locator(".stat-card").count(), 4)
  assert.equal(await page.locator(".stat-value").first().textContent(), "13")
  assert.equal(
    await page
      .getByRole("region", { name: "Job distribution" })
      .locator("svg.recharts-surface")
      .count(),
    1
  )
  assert.equal(
    await page
      .locator(
        ".stats-caption, .read-limitations, .sort-label, .table-count, .playground-guide, .shared-feed"
      )
      .count(),
    0
  )
  assert.equal(
    await page.locator('.sidebar-item[aria-current="page"]').innerText(),
    "Background Jobs"
  )
  assert.equal(await page.locator(".sidebar-item:disabled").count(), 4)
  await page.screenshot({
    path: resolve(output, "dashboard-desktop.png"),
    fullPage: true
  })
  checks.push(
    "dark workspace shell, jobs-only navigation, global statistics/chart and semantic jobs table"
  )
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  assert.equal(
    await page.getByRole("button", { name: "Run scenario", exact: true }).isDisabled(),
    true
  )
  assert.equal(
    await page
      .getByRole("button", { name: "Reset my sandbox", exact: true })
      .isDisabled(),
    true
  )
  await page.getByRole("button", { name: "demo-job-02", exact: true }).click()
  await text(page.getByRole("region", { name: "Job details" }), "Unknown outcome")
  assert.equal(
    await page
      .getByRole("button", { name: "Cancel · unavailable", exact: true })
      .isDisabled(),
    true
  )
  assert.match(
    await page.getByRole("region", { name: "Job details" }).innerText(),
    /Payload and protected fields are unavailable/
  )
  checks.push(
    "own sandbox, mock source, disabled commands, unknown observation and private detail allowlist"
  )

  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await text(page.locator('nav[aria-label="Pagination"]'), "Page 2")
  await text(status(), "connected")
  assert.equal(await rows().first().getByRole("button").innerText(), "demo-job-06")
  const cursor = await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor)
  await page.getByLabel("Search job ID on this page").fill("06")
  await page.evaluate(() => window.jobsBrowserTest.update())
  await read()
  assert.equal(await rows().count(), 1)
  assert.match(await rows().first().innerText(), /Completed/)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor),
    cursor
  )
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().selected),
    "demo-job-02"
  )
  assert.equal(await page.getByLabel("Search job ID on this page").inputValue(), "06")
  checks.push(
    "page 2 lifecycle update replaces metadata and retains opaque cursor, selected job and local search"
  )

  await page.evaluate(() => window.jobsBrowserTest.mode("invalid-cursor"))
  await read()
  await text(status(), "stale · invalid-request")
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor),
    cursor
  )
  await page.evaluate(() => window.jobsBrowserTest.mode("normal"))
  await page.getByRole("button", { name: "First page", exact: true }).click()
  await text(status(), "connected")
  await page.getByLabel("Search job ID on this page").fill("")
  await page.getByLabel("State", { exact: true }).selectOption("Dead")
  await page.getByLabel("Kind (exact)").fill("playground.scenario")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await text(status(), "connected")
  assert.equal(await rows().count(), 2)
  await page.getByLabel("Kind (exact)").fill("absent")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await text(
    page.getByRole("region", { name: "Jobs list" }),
    "No jobs match on this page"
  )
  checks.push(
    "combined state/kind filters, empty state and explicit invalid-cursor restart"
  )

  await page.getByLabel("Kind (exact)").fill("playground.scenario")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await text(status(), "connected")
  await page.evaluate(() => window.jobsBrowserTest.mode("error"))
  await read()
  await text(status(), "stale · unavailable")
  assert.equal(await rows().count(), 2)
  await page.evaluate(() => window.jobsBrowserTest.mode("normal"))
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await text(status(), "connected")
  assert.equal(await page.getByLabel("State", { exact: true }).inputValue(), "Dead")
  await page.getByRole("button", { name: "Refresh reads", exact: true }).focus()
  await page.keyboard.press("Enter")
  await text(status(), "connected")
  assert.equal(
    await page
      .getByRole("button", { name: "Refresh reads", exact: true })
      .evaluate((node) => node === document.activeElement),
    true
  )
  checks.push(
    "stale-data retention, online reconnect and keyboard activation/focus stability"
  )
  await accessibility()
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Close details", exact: true }).click()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  await page.getByLabel("State", { exact: true }).selectOption("")
  await page.getByRole("button", { name: "Apply filters", exact: true }).click()
  await text(status(), "connected")
  await page.getByLabel("Due Pending on this page (browser clock)").check()
  assert.equal(await rows().count(), 1)
  await page.getByLabel("Due Pending on this page (browser clock)").uncheck()
  await page.getByRole("button", { name: "demo-job-01", exact: true }).focus()
  await page.keyboard.press("Enter")
  await text(page.getByRole("region", { name: "Job details" }), "Producer identity")
  assert.equal(
    await page
      .getByRole("region", { name: "Job details" })
      .evaluate((node) => node === document.activeElement),
    true
  )
  await accessibility()
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true })
  checks.push(
    "390px viewport without horizontal overflow, due page view and keyboard detail navigation"
  )
  checks.push("axe-core WCAG 2 A/AA and 2.1 AA: zero violations on desktop and mobile")
  await page.evaluate(() => window.jobsBrowserTest.generation())
  await read()
  await text(page.locator("main"), "generation 2")
  assert.equal(await rows().count(), 0)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().selected),
    undefined
  )
  checks.push("external reset revokes old data and selection with generation explanation")

  await page.goto(`${url}/commands`)
  await text(status(), "connected")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await page.getByLabel("Fake provider behavior").selectOption("unknown-outcome")
  await page.getByLabel("Jobs (1–10)").fill("2")
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await text(
    page.getByRole("region", { name: "Scenario launcher" }),
    "Outcome unknown. Do not replay"
  )
  assert.equal(
    await page.getByRole("button", { name: "Run scenario", exact: true }).isDisabled(),
    true
  )
  assert.equal(
    await page
      .getByRole("button", { name: "Reset my sandbox", exact: true })
      .isDisabled(),
    true
  )
  await page
    .getByRole("button", { name: "Check exact request receipt", exact: true })
    .click()
  await text(
    page.getByRole("region", { name: "Scenario launcher" }),
    "Absence does not authorize replay"
  )
  assert.equal(await page.evaluate(() => window.jobsBrowserTest.runs()), 1)
  await page.screenshot({ path: resolve(output, "unknown-outcome.png"), fullPage: true })
  checks.push(
    "scripted command outcome unknown locks writes; exact receipt absence never replays"
  )
  await page.goto(`${url}/commands`)
  await text(status(), "connected")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await text(page.locator("main"), "generation 2")
  assert.equal(await rows().count(), 0)
  checks.push(
    "confirmed own-sandbox reset hides previous generation without claiming cancellation"
  )
  await page.goto(`${url}/poll`)
  await text(status(), "connected")
  await page.waitForFunction(() => window.jobsBrowserTest.requests().length >= 2, null, {
    timeout: 8_000
  })
  await page.evaluate(() => window.jobsBrowserTest.dispose())
  assert.equal(await page.locator("main").innerText(), "")
  checks.push("real five-second visible-page reconciliation and cleanup")
  await page.goto(`${url}/fixture`)
  await text(status(), "connected")
  assert.equal(await rows().count(), 5)
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  assert.equal(
    await page.getByRole("button", { name: "Run scenario", exact: true }).isDisabled(),
    true
  )
  assert.deepEqual(errors, [])
  checks.push("standalone development fixture entry loads without browser errors")
  await page.goto(`${url}/docs/jobs`)
  await page
    .getByRole("heading", { name: "Reading durable jobs.", exact: true })
    .waitFor()
  await accessibility()
  await page.getByRole("link", { name: "Unknown outcomes", exact: true }).click()
  assert.equal(new URL(page.url()).hash, "#unknown")
  await page.getByRole("link", { name: "Return to jobs playground", exact: true }).click()
  await text(status(), "connected")
  checks.push(
    "static documentation route, anchor navigation, return link and WCAG checks"
  )
  const hashes = Object.fromEntries(
    Object.entries({
      ...scripts,
      "/Jobs.css": css,
      "/Fixture.html": Buffer.from(html),
      "/docs/jobs": guide
    }).map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")])
  )
  const receipt = {
    result: "PASS",
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["write-tree"], { encoding: "utf8" }).trim(),
    source: "local Chromium / UI fixtures only",
    browser: browser.version(),
    playwright: require("playwright/package.json").version,
    axe: require("axe-core/package.json").version,
    checks,
    hashes
  }
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  )
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  if (browser !== undefined) {
    await browser.close()
  }
  await new Promise((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed()))
  )
}
