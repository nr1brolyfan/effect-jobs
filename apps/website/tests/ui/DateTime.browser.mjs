// Build/browser FFI: qualify compiled components with synthetic public data only.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const baseline = process.argv.includes("--before")
const base = "68f19504df18825e7e8db2769d06e18122484887"
const output = resolve(`.multica/datetime-browser/${baseline ? "before" : "after"}`)
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve("apps/website/tests/ui/.datetime-browser-"))
const sources = [
  "Theme.stylex.ts",
  "Primitives.stylex.ts",
  "Primitives.tsx",
  "Popover.stylex.ts",
  "Popover.tsx",
  "DateTime.stylex.ts",
  "DateTimeFormat.ts",
  "DateTime.tsx"
]
const rules = []
const inputs = {}
let server, browser
const errors = [],
  checks = []
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
try {
  await mkdir(resolve(scratch, "src/ui"), { recursive: true })
  await mkdir(resolve(scratch, "tests/ui"), { recursive: true })
  const paths = [
    ...sources.map((name) => `src/ui/${name}`),
    "tests/ui/DateTime.render.tsx"
  ]
  for (const path of paths) {
    const source =
      baseline && path.startsWith("src/")
        ? execFileSync("git", ["show", `${base}:apps/website/${path}`], {
            encoding: "utf8"
          })
        : await readFile(resolve("apps/website", path), "utf8")
    inputs[path] = hash(source)
    const transpiler = new Bun.Transpiler({
      loader: path.endsWith("tsx") ? "tsx" : "ts",
      tsconfig: JSON.stringify({
        compilerOptions: { jsx: "react", jsxFactory: "React.createElement" }
      })
    })
    await writeFile(
      resolve(scratch, path.replace(/\.tsx?$/, ".js")),
      `import * as React from "react";\n${transpiler.transformSync(source)}`
    )
  }
  for (const path of paths) {
    const filename = resolve(scratch, path.replace(/\.tsx?$/, ".js"))
    const result = await transformAsync(await readFile(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          stylexPlugin,
          {
            dev: false,
            runtimeInjection: false,
            treeshakeCompensation: true,
            unstable_moduleResolution: { type: "commonJS", rootDir: scratch }
          }
        ]
      ]
    })
    assert.ok(result?.code)
    assert.doesNotMatch(result.code, /\bstylex\.(create|defineVars)\s*\(/)
    rules.push(...(result.metadata.stylex ?? []))
    await writeFile(filename, result.code)
  }
  const built = await Bun.build({
    entrypoints: [resolve(scratch, "tests/ui/DateTime.render.js")],
    target: "browser",
    minify: true,
    outdir: output,
    naming: "DateTime.js",
    define: { "process.env.NODE_ENV": JSON.stringify("production") }
  })
  assert.equal(built.success, true, JSON.stringify(built.logs))
  const css =
    (await readFile("apps/website/src/styles/Jobs.css", "utf8")) +
    "\n" +
    stylexPlugin.processStylexRules(rules) +
    "\nbody{margin:24px;background:#101510;color:#e5eddf;font:14px sans-serif}table{table-layout:fixed;width:100%;max-width:600px}th,td{text-align:left;padding:8px;vertical-align:top}th{font-weight:400}dd{margin:0;max-width:170px}.detail{display:grid;grid-template-columns:110px minmax(0,170px);gap:12px}section{display:flex;flex-direction:column;gap:8px}button{box-sizing:border-box}h1{font-size:20px}"
  await writeFile(resolve(output, "Jobs.css"), css)
  const script = await readFile(resolve(output, "DateTime.js"))
  const axeScript = await readFile(require.resolve("axe-core/axe.min.js"))
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
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
  const url = `http://127.0.0.1:${server.address().port}`
  await page.goto(url)
  const trigger = page.getByRole("button", { name: /^Updated:/ })
  await expect(trigger).toBeVisible()
  const geometry = async () =>
    trigger.evaluate((node) => {
      const css = getComputedStyle(node),
        date = node.querySelector("time"),
        hint = node.querySelector("span")
      return {
        fontWeight: css.fontWeight,
        paddingInlineStart: css.paddingInlineStart,
        alignItems: css.alignItems,
        flexDirection: css.flexDirection,
        textAlign: css.textAlign,
        minHeight: css.minHeight,
        width: node.getBoundingClientRect().width,
        containerWidth: node.parentElement.getBoundingClientRect().width,
        dateX: date.getBoundingClientRect().x,
        hintX: hint.getBoundingClientRect().x,
        buttonX: node.getBoundingClientRect().x
      }
    })
  const desktop = await geometry()
  const details = await page
    .getByRole("button", { name: /^Available:/ })
    .evaluate((node) => ({
      dateX: node.querySelector("time").getBoundingClientRect().x,
      hintX: node.querySelector("span").getBoundingClientRect().x,
      containerX: node.parentElement.getBoundingClientRect().x
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
  const receipt = {
    result: "PASS",
    baseline,
    base,
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    source: "isolated synthetic DateTime and real Base UI; no8787",
    inputs,
    hashes: {
      script: hash(script),
      css: hash(css),
      fixture: inputs["tests/ui/DateTime.render.tsx"]
    },
    versions: {
      browser: browser.version(),
      playwright: require("@playwright/test/package.json").version
    },
    desktop,
    details,
    focusRing,
    mobile,
    bounds,
    checks,
    errors,
    csp: []
  }
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  )
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  if (browser) {
    await browser.close()
  }
  if (server) {
    await new Promise((done, reject) =>
      server.close((error) => (error ? reject(error) : done()))
    )
  }
  await rm(scratch, { recursive: true, force: true })
}
