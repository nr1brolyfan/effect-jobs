import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer, type Server } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import type { Browser } from "@playwright/test"
// Standalone tooling FFI; canonical Vite/StyleX build, complete retained browser oracle.
const { buildFixture } = (await import(
  new URL("../../modernization/FixtureServer.ts", import.meta.url).href
)) as typeof import("../../modernization/FixtureServer.js")
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test")
const output = resolve(".multica/focus-browser")
await mkdir(output, { recursive: true })
const { script, css } = await buildFixture(
  "apps/website/tests/ui/details/Focus.render.tsx"
)
const inputs = {
  entry: "apps/website/tests/ui/details/Focus.render.tsx",
  compiler: "canonical Vite"
}
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
const axe = await readFile(require.resolve("axe-core/axe.min.js"))
const errors: string[] = [],
  checks: string[] = []
let server: Server | undefined, browser: Browser | undefined
declare global {
  interface Window {
    focusFixture: {
      pending: () => number
      release: () => void
      refresh: () => void | Promise<unknown>
      events: () => ReadonlyArray<{
        tag: string
        jobId: string | null
        text: string | null
      }>
      replace: () => void
      remove: () => void
      dispose: () => void | Promise<void>
    }
  }
}
try {
  server = createServer((req, res) => {
    if (
      req.url === "/Details.js" ||
      req.url === "/Details.css" ||
      req.url === "/axe.js"
    ) {
      res.setHeader(
        "content-type",
        req.url.endsWith("css") ? "text/css" : "text/javascript"
      )
      res.end(req.url === "/Details.js" ? script : req.url === "/Details.css" ? css : axe)
    } else {
      res.setHeader("content-type", "text/html")
      res.end(
        '<!doctype html><html lang="en"><head><title>Details fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/Details.css"></head><body><div id="fixture"></div><script type="module" src="/Details.js"></script></body></html>'
      )
    }
  })
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done))
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`
  await page.goto(`${origin}/demo`)
  const selected = page.locator("button[data-job-id]").first()
  await expect(selected).toBeVisible()
  const selectedId = await selected.getAttribute("data-job-id")
  await selected.click()
  await page.waitForFunction(() => window.focusFixture.pending() > 0)
  const beforeDetail = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    jobId: document.activeElement?.getAttribute("data-job-id"),
    text: document.activeElement?.textContent?.slice(0, 100)
  }))
  await page.evaluate(() => window.focusFixture.release())
  await expect(page.getByRole("dialog", { name: "Quick job details" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // Base UI restores focus in a microtask; let the closing commit settle before assertions.
  await page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  )
  const afterEscape = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    jobId: document.activeElement?.getAttribute("data-job-id"),
    text: document.activeElement?.textContent?.slice(0, 100)
  }))
  const events = await page.evaluate(() => window.focusFixture.events())
  await writeFile(
    resolve(output, "probe.json"),
    JSON.stringify(
      {
        selectedId,
        beforeDetail,
        afterEscape,
        events,
        errors,
        chromium: browser.version(),
        inputs,
        cssSha256: hash(css),
        scriptSha256: hash(script)
      },
      null,
      2
    ) + "\n"
  )
  await expect(page.locator(`button[data-job-id="${selectedId}"]`)).toBeFocused()
  checks.push("actual Dashboard delayed detail Escape restores current selected button")
  await selected.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.evaluate(() => window.focusFixture.refresh())
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // Base UI restores focus in a microtask; let the closing commit settle before assertions.
  await page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  )
  await expect(page.locator(`button[data-job-id="${selectedId}"]`)).toBeFocused()
  checks.push(
    "actual Dashboard live read refresh retains drawer identity and restores replacement opener"
  )
  await page.goto(`${origin}/isolated`)
  const opener = page.getByRole("button", { name: "Inspect synthetic job" })
  await opener.click()
  const dialog = page.getByRole("dialog", { name: "Quick job details" })
  await expect(dialog).toBeVisible()
  await page.getByRole("button", { name: "Synthetic locked" }).click()
  const originalDialog = await dialog.elementHandle()
  assert(originalDialog)
  const oldOpener = await page.locator("button[data-job-id]").elementHandle()
  assert(oldOpener)
  await page.evaluate(() => window.focusFixture.refresh())
  await page.evaluate(() => new Promise<number>((done) => requestAnimationFrame(done)))
  await expect(page.getByRole("button", { name: "Synthetic unlocked" })).toBeVisible()
  assert.equal(await originalDialog.evaluate((node) => node.isConnected), true)
  await page.evaluate(() => window.focusFixture.replace())
  await page.waitForFunction((node) => !node!.isConnected, oldOpener)
  assert.equal(await oldOpener.evaluate((node) => node.isConnected), false)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  )
  await expect(opener).toBeFocused()
  assert.equal(await page.locator("html").getAttribute("data-closed-slot"), "true")
  checks.push(
    "same-identity refresh preserves dialog/volatile slot; replaced opener restored after Escape; close unmounts slot"
  )
  await opener.click()
  await expect(dialog).toBeVisible()
  await expect(page.getByRole("button", { name: "Synthetic locked" })).toBeVisible()
  await page.evaluate(() => window.focusFixture.remove())
  await expect(opener).toHaveCount(0)
  await page.getByRole("button", { name: "Close job details" }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  )
  await expect(page.locator("[data-jobs-focus-fallback]")).toBeFocused()
  checks.push(
    "truly removed selected opener uses approved jobs fallback after Close; reopened slot is locked"
  )
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result:
          "PASS synthetic reads with actual Dashboard/Runtime; real PG/workerd NotTested",
        checks,
        inputs,
        chromium: browser.version(),
        scriptSha256: hash(script),
        cssSha256: hash(css)
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ checks }, null, 2))
} finally {
  if (browser) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.evaluate(() => window.focusFixture?.dispose()).catch(() => {})
      }
    }
    await browser.close()
  }
  if (server) {
    await new Promise<void>((done, reject) =>
      server!.close((error) => (error ? reject(error) : done()))
    )
  }

  await writeFile(
    resolve(output, "cleanup.json"),
    JSON.stringify(
      {
        browserClosed: true,
        serverClosed: true,
        scratchRemoved: true
      },
      null,
      2
    ) + "\n"
  )
}
