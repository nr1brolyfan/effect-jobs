import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer, type Server } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import type { Browser } from "@playwright/test"
// Standalone browser FFI; actual canonical Vite/StyleX sources and Base UI.

const { buildFixture } = (await import(
  new URL("../modernization/FixtureServer.ts", import.meta.url).href
)) as typeof import("../modernization/FixtureServer.js")
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test")
declare global {
  interface Window {
    datetimeCsp?: string[]
  }
}
const baseline = false
assert(
  !process.argv.includes("--before"),
  "Historical snapshots are archived evidence, not current source qualification"
)
const output = resolve(".multica/datetime-browser/after")
await mkdir(output, { recursive: true })
const fixture = await buildFixture("apps/website/tests/ui/DateTime.render.tsx")
const script = fixture.script
const css =
  fixture.css.toString() +
  "\nbody{margin:24px;background:#101510;color:#e5eddf;font:14px sans-serif}table{table-layout:fixed;width:100%;max-width:600px}th,td{text-align:left;padding:8px;vertical-align:top}th{font-weight:400}dd{margin:0;max-width:170px}.detail{display:grid;grid-template-columns:110px minmax(0,170px);gap:12px}section{display:flex;flex-direction:column;gap:8px}button{box-sizing:border-box}h1{font-size:20px}"
assert.doesNotMatch(script.toString(), /\bstylex\.(create|defineVars)\s*\(/)
assert.match(css, /:focus-visible/)
assert.match(css, /@media\s*\(pointer:\s*coarse\)/)
assert.match(css, /min-height:\s*44px/)
const axeScript = await readFile(require.resolve("axe-core/axe.min.js"))
const errors: string[] = [],
  checks: string[] = []
let server: Server | undefined, browser: Browser | undefined
try {
  server = createServer((req, res) => {
    if (req.url === "/axe.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.end(axeScript)
    } else if (req.url === "/DateTime.js" || req.url === "/Jobs.css") {
      res.setHeader(
        "Content-Type",
        req.url.endsWith("js") ? "text/javascript" : "text/css"
      )
      res.end(req.url.endsWith("js") ? script : css)
    } else {
      res.setHeader("Content-Type", "text/html")
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"
      )
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>DateTime fixture</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="fixture"></main><script type="module" src="/DateTime.js"></script></body></html>'
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    timezoneId: "Europe/Warsaw",
    locale: "en-GB"
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      window.datetimeCsp = [...(window.datetimeCsp ?? []), event.violatedDirective]
    })
  )
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`
  await page.goto(url)
  const trigger = page.getByRole("button", { name: /^Updated:/ })
  await expect(trigger).toBeVisible()
  const geometry = async () =>
    trigger.evaluate((node) => {
      const css = getComputedStyle(node),
        date = node.querySelector("time")!,
        hint = node.querySelector("span")!
      return {
        fontWeight: css.fontWeight,
        paddingInlineStart: css.paddingInlineStart,
        alignItems: css.alignItems,
        flexDirection: css.flexDirection,
        textAlign: css.textAlign,
        minHeight: css.minHeight,
        width: node.getBoundingClientRect().width,
        containerWidth: node.parentElement!.getBoundingClientRect().width,
        dateX: date!.getBoundingClientRect().x,
        hintX: hint!.getBoundingClientRect().x,
        buttonX: node.getBoundingClientRect().x
      }
    })
  const desktop = await geometry()
  const details = await page
    .getByRole("button", { name: /^Available:/ })
    .evaluate((node) => ({
      dateX: node.querySelector("time")!.getBoundingClientRect().x,
      hintX: node.querySelector("span")!.getBoundingClientRect().x,
      containerX: node.parentElement!.getBoundingClientRect().x
    }))
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true })
  await trigger.focus()
  const focusRing = await trigger.evaluate((node) => ({
    style: getComputedStyle(node).outlineStyle,
    width: getComputedStyle(node).outlineWidth
  }))
  await page.keyboard.press("Enter")
  const popup = page.getByRole("dialog", { name: "Updated", exact: true })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText("02:30:00.123")
  await expect(popup).toContainText("GMT+02:00")
  await expect(popup).toContainText("00:30:00.123")
  await expect(popup).toContainText("2026-10-25T00:30:00.123Z")
  assert.equal(
    await trigger.locator("time").getAttribute("datetime"),
    "2026-10-25T00:30:00.123Z"
  )
  if (!baseline) {
    assert.equal(
      await popup.getByRole("button", { name: "Close", exact: true }).count(),
      0
    )
  }
  assert.equal(
    await popup
      .locator("dd")
      .last()
      .evaluate((node) => getComputedStyle(node).userSelect),
    "text"
  )
  await page.screenshot({ path: resolve(output, "desktop-popup.png"), fullPage: true })
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Space")
  await expect(popup).toBeVisible()
  await expect(
    baseline ? popup.getByRole("button", { name: "Close", exact: true }) : popup
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Space")
  await expect(popup).toBeVisible()
  await expect(
    baseline ? popup.getByRole("button", { name: "Close", exact: true }) : popup
  ).toBeFocused()
  await page.keyboard.press("Tab")
  // A nonmodal popover allows Tab to leave; it must not steal that focus back.
  await expect(popup).toBeHidden()
  await expect(page.getByRole("button", { name: /^Terminal:/ })).toBeFocused()
  await trigger.click()
  await page.locator("#outside").click()
  await expect(popup).toBeHidden()
  await expect(page.locator("#outside")).toBeFocused()
  checks.push(
    "Enter/Space opens exact local/UTC/ISO; Escape returns focus; outside click preserves outside focus; Tab traversal"
  )
  assert.equal(await page.getByText("Not recorded", { exact: true }).count(), 2)
  assert.equal(await page.getByText("Invalid timestamp", { exact: true }).count(), 1)
  assert.equal(
    await page
      .getByRole("button", { name: /^Epoch:/ })
      .locator("time")
      .getAttribute("datetime"),
    "1970-01-01T00:00:00.000Z"
  )
  await page.getByRole("button", { name: "Default popover", exact: true }).click()
  const defaultPopup = page.getByRole("dialog", { name: "Default popup" })
  await defaultPopup.getByRole("button", { name: "Close", exact: true }).click()
  await expect(defaultPopup).toBeHidden()
  checks.push(
    "null/undefined/invalid/epoch semantics; unrelated default Popover Close retained"
  )
  if (!baseline) {
    assert.equal(desktop.fontWeight, "400")
    assert.equal(desktop.paddingInlineStart, "0px")
    assert.equal(desktop.alignItems, "baseline")
    assert.equal(desktop.flexDirection, "row")
    assert(desktop.hintX > desktop.dateX)
    assert(Math.abs(desktop.dateX - desktop.buttonX) < 1)
    assert(desktop.width <= desktop.containerWidth)
    assert(Math.abs(details.dateX - details.containerX) < 1)
    assert(details.hintX > details.dateX)
    assert.deepEqual(focusRing, { style: "solid", width: "2px" })
  }
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "Europe/Warsaw",
    locale: "en-GB"
  })
  const mobilePage = await touch.newPage()
  mobilePage.on("pageerror", (error) => errors.push(error.message))
  await mobilePage.goto(url)
  const mobileTrigger = mobilePage.getByRole("button", { name: /^Updated:/ })
  await expect(mobileTrigger).toBeVisible()
  await mobilePage.screenshot({ path: resolve(output, "mobile.png"), fullPage: true })
  await mobileTrigger.tap()
  const mobilePopup = mobilePage.getByRole("dialog", { name: "Updated", exact: true })
  await expect(mobilePopup).toBeVisible()
  const mobile = await mobileTrigger.boundingBox(),
    bounds = await mobilePopup.boundingBox()
  assert(mobile && bounds)
  assert(mobile.height >= 44)
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  assert(
    await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  )
  await mobilePage.screenshot({
    path: resolve(output, "mobile-popup.png"),
    fullPage: true
  })
  await mobilePage.locator("#outside").tap()
  await expect(mobilePopup).toBeHidden()
  checks.push(
    "390px emulated touch opens/outside dismisses; 44px target; popup/ISO inside viewport"
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(await page.evaluate(() => window.datetimeCsp ?? []), [])
  const hash = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex")
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS",
        source: "canonical Vite; synthetic presentation; real Base UI",
        scriptSha256: hash(script),
        cssSha256: hash(css),
        checks,
        errors,
        desktop,
        details,
        focusRing,
        mobile,
        bounds
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ result: "PASS", checks }))
} finally {
  await browser?.close()
  if (server) {
    await new Promise<void>((done, reject) =>
      server!.close((error) => (error ? reject(error) : done()))
    )
  }
}
