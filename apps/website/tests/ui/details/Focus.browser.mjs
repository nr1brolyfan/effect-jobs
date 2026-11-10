// Focused browser FFI: actual Dashboard/Runtime with synthetic reads, plus drawer lifecycle.
// This does not qualify real API/workerd/PG routing.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"
import transformTypescript from "@babel/plugin-transform-typescript"
import transformReactJsx from "@babel/plugin-transform-react-jsx"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve("evidence/focus-browser")
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve("apps/website/tests/ui/details/.browser-"))
const walk = async (directory) => {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      paths.push(...(await walk(path)))
    } else if (/\.tsx?$/.test(entry.name)) {
      paths.push(path)
    }
  }
  return paths
}
const paths = [
  ...(await walk("apps/website/src")).map((path) => path.slice("apps/website/".length)),
  "tests/ui/details/Focus.render.tsx"
]
const rules = [],
  inputs = {},
  errors = [],
  checks = []
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
let browser, server
try {
  for (const path of paths) {
    const text = await readFile(resolve("apps/website", path), "utf8")
    inputs[path] = hash(text)
    const filename = resolve(scratch, path.replace(/\.tsx?$/, ".js"))
    await mkdir(dirname(filename), { recursive: true })
    const transpiled = await transformAsync(text, {
      filename: path,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          transformTypescript,
          {
            isTSX: path.endsWith(".tsx"),
            allExtensions: true,
            onlyRemoveTypeImports: true
          }
        ],
        [transformReactJsx, { runtime: "automatic" }]
      ]
    })
    await writeFile(filename, transpiled.code)
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
    assert.doesNotMatch(result.code, /stylex\.(?:create|defineVars)\s*\(/)
    rules.push(...(result.metadata.stylex ?? []))
    await writeFile(filename, result.code)
  }
  const build = await Bun.build({
    entrypoints: [resolve(scratch, "tests/ui/details/Focus.render.js")],
    plugins: [
      {
        name: "scenario-wire-schema",
        setup(build) {
          build.onResolve(
            { filter: /playground-worker\/src\/scenarios\/Definitions\.js$/ },
            () => ({
              path: resolve("apps/playground-worker/src/scenarios/Definitions.ts")
            })
          )
        }
      }
    ],
    target: "browser",
    outdir: output,
    naming: "Details.js",
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") }
  })
  assert.equal(build.success, true, JSON.stringify(build.logs))
  const script = await readFile(resolve(output, "Details.js"))
  const css =
    (await readFile("apps/website/src/styles/Jobs.css", "utf8")) +
    "\n" +
    stylexPlugin.processStylexRules(rules)
  await writeFile(resolve(output, "Details.css"), css)
  const axe = ""
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  const origin = `http://127.0.0.1:${server.address().port}`
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
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
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
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
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
  const oldOpener = await page.locator("button[data-job-id]").elementHandle()
  await page.evaluate(() => window.focusFixture.refresh())
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
  await expect(page.getByRole("button", { name: "Synthetic unlocked" })).toBeVisible()
  assert.equal(await originalDialog.evaluate((node) => node.isConnected), true)
  await page.evaluate(() => window.focusFixture.replace())
  await page.waitForFunction((node) => !node.isConnected, oldOpener)
  assert.equal(await oldOpener.evaluate((node) => node.isConnected), false)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
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
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
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
    await new Promise((done) => server.close(done))
  }
  await rm(scratch, { recursive: true, force: true })
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
