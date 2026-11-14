import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import type { Browser, Locator } from "@playwright/test"
import type {} from "./BrowserEntry.js"
import { createHash } from "node:crypto"

// Use the pinned local worker Playwright toolchain.
const require = createRequire(
  resolve(process.env.UI_PLAYWRIGHT_PACKAGE ?? "apps/playground-worker/package.json")
)
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test")
const output = resolve(".multica/ui-browser")
await mkdir(output, { recursive: true })
const { buildFixture } = (await import(
  new URL("../../../playground/tests/fixtures/BuildFixture.ts", import.meta.url).href
)) as typeof import("../../../playground/tests/fixtures/BuildFixture.js")
const fixture = await buildFixture(
  resolve("apps/playground/tests/fixtures/FixtureEntry.ts"),
  resolve(output, "fixture")
)
const live = await buildFixture(
  resolve("apps/website/tests/ui/BrowserEntry.ts"),
  resolve(output, "browser")
)
await writeFile(resolve(output, "FixtureEntry.js"), fixture.script)
await writeFile(resolve(output, "BrowserEntry.js"), live.script)
await writeFile(resolve(output, "Jobs.css"), Buffer.concat([fixture.css, live.css]))
const css = await readFile(resolve(output, "Jobs.css"))
const html = await readFile("apps/playground/tests/fixtures/Fixture.html", "utf8")
const { guideAssets } = (await import(
  new URL("../modernization/Guide.ts", import.meta.url).href
)) as typeof import("../modernization/Guide.js")
const canonicalAssets = guideAssets()
const scripts: Record<string, Buffer> = {
  "/FixtureEntry.js": await readFile(resolve(output, "FixtureEntry.js")),
  "/BrowserEntry.js": await readFile(resolve(output, "BrowserEntry.js"))
}
const axeScript = await readFile(require.resolve("axe-core/axe.min.js"))
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname
  if (path === "/axe.js") {
    res.setHeader("content-type", "text/javascript")
    res.end(axeScript)
  } else if (path === "/Jobs.css") {
    res.setHeader("content-type", "text/css")
    res.end(css)
  } else if (Object.hasOwn(scripts, path)) {
    res.setHeader("content-type", "text/javascript")
    res.end(scripts[path])
  } else if (
    path === "/docs" ||
    path.startsWith("/docs/") ||
    path.startsWith("/_astro/") ||
    path.startsWith("/_assets/")
  ) {
    const asset = canonicalAssets(
      new Request(new URL(req.url ?? "/", "http://localhost"))
    )
    res.writeHead(asset.status, Object.fromEntries(asset.headers))
    asset
      .arrayBuffer()
      .then((bytes) => res.end(Buffer.from(bytes)))
      .catch((error) => res.destroy(error))
  } else if (["/jobs", "/demo", "/commands", "/fixture", "/poll"].includes(path)) {
    res.setHeader("content-type", "text/html")
    res.end(
      new URL(req.url ?? "/", "http://localhost").searchParams.has("fixture")
        ? html
        : html.replace("/FixtureEntry.js", "/BrowserEntry.js")
    )
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise<void>((resolveListening) =>
  server.listen(0, "127.0.0.1", resolveListening)
)
const address = server.address()
assert(address && typeof address === "object")
const url = `http://127.0.0.1:${address.port}`
let browser: Browser | undefined
const checks: string[] = []
const errors: string[] = []
const accessibilityFailures: unknown[] = []
const focusableChartNodes: unknown[] = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH === undefined
      ? {}
      : { executablePath: process.env.UI_CHROMIUM_PATH })
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => {
    errors.push(error.message)
    console.error("Browser error:", error.message)
  })
  const text = async (locator: Locator, expected: string) => {
    await locator.filter({ hasText: expected }).first().waitFor({ timeout: 10_000 })
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        )
    )
  }
  const status = () => page.locator(".connection-status")
  const rows = () => page.locator(".job-list tr")
  const read = async () => {
    await page.evaluate(() => window.jobsBrowserTest.reconcile())
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        )
    )
  }
  const accessibility = async () => {
    await page.addScriptTag({ url: "/axe.js" })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({ target: node.target, html: node.html }))
      }))
    )
    accessibilityFailures.push(...violations)
    focusableChartNodes.push(
      ...(await page
        .locator('[aria-hidden="true"] [tabindex="0"]')
        .evaluateAll((nodes) => nodes.map((node) => node.outerHTML)))
    )
  }
  await page.goto(`${url}/jobs`)
  await text(status(), "connected")
  await expect(rows()).toHaveCount(20)
  assert.equal(
    await page.getByRole("heading", { name: "Background Jobs", exact: true }).count(),
    1
  )
  assert.equal(await page.getByRole("table", { name: "Background jobs" }).count(), 1)
  assert.equal(await page.locator(".stat-card").count(), 4)
  assert.equal(await page.locator(".stat-value").first().textContent(), "43")
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
  assert(await page.getByRole("button", { name: "Create jobs", exact: true }).isEnabled())
  await page.locator(".scenario-panel summary").click()
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
  await text(page.getByRole("dialog"), "Active")
  assert.equal(
    await page.evaluate(
      () => window.jobsBrowserTest.snapshot().detail?.observation?.outcome
    ),
    "unknown"
  )
  assert.equal(await page.getByRole("button", { name: /Cancel/ }).count(), 0)
  await expect(
    page.getByLabel("Payload unavailable: not stored.", { exact: true })
  ).toBeVisible()
  await expect(page.getByLabel("Encoded payload", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Readable payload", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Close job details", exact: true }).click()
  checks.push(
    "own sandbox, mock source, disabled commands, unknown observation and private detail allowlist"
  )

  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await text(status(), "connected")
  assert.equal(
    await rows().first().locator("button[data-job-id]").innerText(),
    "demo-job-21"
  )
  const cursor = await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor)
  await page.evaluate(() => window.jobsBrowserTest.update())
  await read()
  assert.match(await rows().first().innerText(), /Completed/)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor),
    cursor
  )
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().selected),
    undefined
  )
  checks.push(
    "page 2 lifecycle update replaces metadata and retains opaque cursor after explicit detail close"
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
  await page.getByRole("tab", { name: /^Dead/ }).click()
  await text(status(), "connected")
  await expect(rows()).toHaveCount(8)
  checks.push("status tab filtering and explicit invalid-cursor restart")

  await page.evaluate(() => window.jobsBrowserTest.mode("error"))
  await read()
  await text(status(), "stale · unavailable")
  await expect(rows()).toHaveCount(8)
  await page.evaluate(() => window.jobsBrowserTest.mode("normal"))
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await text(status(), "connected")
  await expect(page.getByRole("tab", { name: /^Dead/ })).toHaveAttribute(
    "aria-selected",
    "true"
  )
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
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  await page.getByRole("tab", { name: /^All jobs/ }).click()
  await text(status(), "connected")
  await page.getByRole("button", { name: "demo-job-01", exact: true }).focus()
  await page.keyboard.press("Enter")
  await text(page.getByRole("dialog"), "Quick job details")
  assert.equal(
    await page
      .getByRole("dialog")
      .evaluate((node) => node.contains(document.activeElement)),
    true
  )
  await accessibility()
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true })
  checks.push("390px viewport without horizontal overflow, keyboard detail navigation")
  checks.push(
    `axe-core WCAG 2 A/AA and 2.1 AA: ${accessibilityFailures.length} violations across desktop/mobile audits`
  )
  await page.evaluate(() => window.jobsBrowserTest.generation())
  await read()
  await text(page.locator("main"), "generation 2")
  await expect(rows()).toHaveCount(0)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().selected),
    undefined
  )
  checks.push("external reset revokes old data and selection with generation explanation")

  await page.goto(`${url}/jobs?commands=1`)
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
  await page.goto(`${url}/jobs?commands=1`)
  await text(status(), "connected")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await text(page.locator("main"), "generation 2")
  await expect(rows()).toHaveCount(0)
  checks.push(
    "confirmed own-sandbox reset hides previous generation without claiming cancellation"
  )
  await page.goto(`${url}/jobs?poll=1`)
  await text(status(), "connected")
  await page.waitForFunction(() => window.jobsBrowserTest.requests().length >= 2, null, {
    timeout: 8_000
  })
  await page.evaluate(() => window.jobsBrowserTest.dispose())
  assert.equal(await page.locator("main").innerText(), "")
  const disposed = await page.evaluate(() => ({
    reads: window.jobsBrowserTest.requests().length,
    descriptions: window.jobsBrowserTest.descriptions(),
    writes: window.jobsBrowserTest.runs()
  }))
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"))
    window.dispatchEvent(new Event("offline"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForTimeout(5500)
  assert.deepEqual(
    await page.evaluate(() => ({
      reads: window.jobsBrowserTest.requests().length,
      descriptions: window.jobsBrowserTest.descriptions(),
      writes: window.jobsBrowserTest.runs()
    })),
    disposed
  )
  checks.push(
    "StrictMode mount refreshes; disposal stops reads, writes and events beyond the next poll"
  )
  checks.push("real five-second visible-page reconciliation and cleanup")
  await page.goto(`${url}/jobs?fixture=1`)
  await text(status(), "connected")
  await expect(rows()).toHaveCount(13)
  assert(await page.getByRole("button", { name: "Create jobs", exact: true }).isEnabled())
  await page.locator(".scenario-panel summary").click()
  assert.equal(
    await page.getByRole("button", { name: "Run scenario", exact: true }).isDisabled(),
    true
  )
  assert.deepEqual(errors, [])
  checks.push("standalone development fixture entry loads without browser errors")
  await page.goto(`${url}/docs/jobs`)
  await page.waitForURL("**/docs/playground")
  await page
    .getByRole("heading", { name: "Run the jobs playground locally", exact: true })
    .waitFor()
  // Expressive Code initializes overflowing scrollers after its resize/idle pass.
  // Observe the served component, then test keyboard behavior before the audit.
  const guideCode = page.locator('pre[data-language="sh"]')
  await expect(guideCode).toHaveAttribute("tabindex", "0")
  let reachedGuideCode = false
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press("Tab")
    if (await guideCode.evaluate((node) => node === document.activeElement)) {
      reachedGuideCode = true
      break
    }
  }
  assert.equal(reachedGuideCode, true)
  assert(await guideCode.evaluate((node) => node.matches(":focus-visible")))
  assert.equal(
    await guideCode.evaluate((node) => getComputedStyle(node).outlineStyle),
    "solid"
  )
  const scrollBefore = await guideCode.evaluate((node) => node.scrollLeft)
  await page.keyboard.press("ArrowRight")
  await expect
    .poll(() => guideCode.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(scrollBefore)
  checks.push("official guide scroller readiness, real Tab focus and Arrow scrolling")
  await accessibility()
  await page.locator('main a[href="#commands-and-receipts"]').first().click()
  assert.equal(new URL(page.url()).hash, "#commands-and-receipts")
  assert.equal(await page.locator('main a[href="/demo"]').count(), 0)
  await expect(page.locator("main")).toContainText("No public demo")
  // The public guide now documents local-only setup, not a hosted demo link.
  // Retain the independent local dashboard-return oracle without inventing one.
  await page.goto(`${url}/demo`)
  await page.waitForURL("**/demo")
  await text(status(), "connected")
  checks.push(
    "canonical guide alias, receipts anchor, local-only guidance, local demo and WCAG checks"
  )
  const hashes = Object.fromEntries(
    Object.entries({
      ...scripts,
      "/Jobs.css": css,
      "/Fixture.html": Buffer.from(html),
      "/docs/jobs": Buffer.from(
        await canonicalAssets(new Request("http://localhost/docs/jobs")).arrayBuffer()
      )
    }).map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")])
  )
  const receipt = {
    result: accessibilityFailures.length ? "FAIL" : "PASS",
    accessibilityFailures,
    focusableChartNodes,
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["write-tree"], { encoding: "utf8" }).trim(),
    source: "local Chromium / UI fixtures only",
    browser: browser.version(),
    playwright: require("@playwright/test/package.json").version,
    axe: require("axe-core/package.json").version,
    checks,
    hashes
  }
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  )
  console.log(JSON.stringify(receipt, null, 2))
  assert.deepEqual(accessibilityFailures, [])
} finally {
  if (browser !== undefined) {
    await browser.close()
  }
  await new Promise<void>((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed()))
  )
}
