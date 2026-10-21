import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"

// Use the pinned local worker Playwright toolchain.
const require = createRequire(
  resolve(process.env.UI_PLAYWRIGHT_PACKAGE ?? "apps/playground-worker/package.json")
)
const { chromium, expect } = require("@playwright/test")
const output = resolve(".multica/ui-fixes/dx-browser")
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
  const path = new URL(req.url, "http://localhost").pathname
  if (path === "/Jobs.css") {
    res.setHeader("content-type", "text/css")
    res.end(css)
  } else if (Object.hasOwn(scripts, path)) {
    res.setHeader("content-type", "text/javascript")
    res.end(scripts[path])
  } else if (path === "/docs/jobs") {
    res.setHeader("content-type", "text/html")
    res.end(guide)
  } else if (["/jobs", "/commands", "/fixture", "/poll"].includes(path)) {
    res.setHeader("content-type", "text/html")
    res.end(
      new URL(req.url, "http://localhost").searchParams.has("fixture")
        ? html
        : html.replace("/FixtureEntry.js", "/BrowserEntry.js")
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
    executablePath: process.env.UI_CHROMIUM_PATH
  })
  const page = await browser.newPage({
    permissions: ["clipboard-write", "clipboard-read"]
  })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${url}/jobs?poll=1`)
  await page.waitForFunction(
    () => window.jobsBrowserTest.snapshot().connection === "connected"
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden"
    })
    window.dispatchEvent(new Event("offline"))
    window.dispatchEvent(new Event("online"))
  })
  const hidden = await page.evaluate(() => ({
    connection: window.jobsBrowserTest.snapshot().connection,
    reads: window.jobsBrowserTest.requests().length
  }))
  await page.waitForTimeout(5500)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.requests().length),
    hidden.reads
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForTimeout(5500)
  const visible = await page.evaluate(() => ({
    connection: window.jobsBrowserTest.snapshot().connection,
    reads: window.jobsBrowserTest.requests().length
  }))
  assert.equal(visible.connection, "connected")
  assert(visible.reads > hidden.reads)
  checks.push({
    id: "DX-1",
    hidden,
    afterVisibleAndTimer: visible,
    expected: "fresh read and connected",
    actual: "fresh read, connected"
  })
  await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await page.waitForFunction(
    () => window.jobsBrowserTest.snapshot().connection === "connected"
  )
  await page.getByRole("button", { name: "demo-job-01", exact: true }).click()
  const link = page.getByText("Identity & execution policy", { exact: true })
  await link.waitFor()
  await link.focus()
  const before = await page.evaluate(() => ({
    active: document.activeElement?.textContent,
    reads: window.jobsBrowserTest.requests().length
  }))
  await page.waitForFunction(
    (reads) => window.jobsBrowserTest.requests().length > reads,
    before.reads,
    { timeout: 8000 }
  )
  await page.waitForFunction(
    () => document.activeElement?.textContent === "Identity & execution policy",
    null,
    { timeout: 2000 }
  )
  const after = await page.evaluate(() => ({
    activeTag: document.activeElement?.tagName
  }))
  assert.equal(after.activeTag, "SUMMARY")
  await page.keyboard.press("Enter")
  assert(await link.evaluate((node) => node.parentElement.open))
  checks.push({
    id: "DX-2",
    before,
    after,
    expected: "focused metadata summary retained after unchanged poll",
    actual: "metadata summary retains focus and keyboard activation"
  })
  await page.goto(`${url}/jobs?poll=1`)
  await page.locator('.connection-status[data-connection="connected"]').waitFor()
  await page.getByRole("button", { name: "demo-job-01", exact: true }).click()
  await link.waitFor()
  await page.getByRole("button", { name: "Close job details", exact: true }).click()
  const refresh = page.getByRole("button", { name: "Refresh reads", exact: true })
  await refresh.focus()
  await page.evaluate(() => window.jobsBrowserTest.reconcile())
  assert(await refresh.evaluate((node) => document.activeElement === node))
  checks.push({ id: "outside-focus", result: "PASS" })
  await page.getByRole("button", { name: "demo-job-01", exact: true }).click()
  await link.waitFor()
  const descriptionsBefore = await page.evaluate(() => {
    const before = window.jobsBrowserTest.descriptions()
    window.jobsBrowserTest.delayDescribe(1500)
    void window.jobsBrowserTest.reconcile()
    return before
  })
  await page.waitForFunction(() => window.jobsBrowserTest.reading())
  await page.evaluate(() => {
    window.jobsBrowserTest.delayDescribe(0)
    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForFunction(() => !window.jobsBrowserTest.reading())
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.descriptions()),
    descriptionsBefore + 1
  )
  checks.push({ id: "active-read-overlap-guard", result: "PASS" })
  await link.focus()
  await page.evaluate(() => {
    window.jobsBrowserTest.generation()
    return window.jobsBrowserTest.reconcile()
  })
  await expect(link).toHaveCount(0)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().selected),
    undefined
  )
  checks.push({ id: "generation-revocation", result: "PASS" })
  await page.goto(`${url}/jobs?poll=1`)
  await page.waitForFunction(
    () => window.jobsBrowserTest.snapshot().connection === "connected"
  )
  await page.getByRole("button", { name: "demo-job-01", exact: true }).click()
  await link.waitFor()
  await page.evaluate(() => {
    window.jobsBrowserTest.mode("expired")
    return window.jobsBrowserTest.reconcile()
  })
  await expect(link).toHaveCount(0)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.snapshot().error),
    "sandbox-expired"
  )
  checks.push({ id: "expiry-revocation", result: "PASS" })
  const readsAtDisposal = await page.evaluate(
    () => window.jobsBrowserTest.requests().length
  )
  await page.evaluate(() => window.jobsBrowserTest.dispose())
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForTimeout(5500)
  assert.equal(
    await page.evaluate(() => window.jobsBrowserTest.requests().length),
    readsAtDisposal
  )
  assert.equal(await page.locator("main").innerText(), "")
  checks.push({ id: "poll-and-event-cleanup", result: "PASS" })
  assert.deepEqual(errors, [])
  const receipt = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    browser: browser.version(),
    playwright: require("@playwright/test/package.json").version,
    checks
  }
  await writeFile(
    resolve(output, "dx-browser-result.json"),
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
