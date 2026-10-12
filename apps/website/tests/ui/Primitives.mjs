// Build/browser FFI: qualify compiled components with synthetic public data only.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(".multica/primitives-browser")
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve("apps/website/tests/ui/.primitives-test-"))
const sources = [
  "Theme.stylex.ts",
  "Primitives.stylex.ts",
  "Primitives.tsx",
  "Popover.stylex.ts",
  "Popover.tsx",
  "Pagination.stylex.ts",
  "Pagination.tsx"
]
const rules = []
const inputs = {}
let server, browser
const errors = [],
  csp = [],
  checks = []
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
try {
  await mkdir(resolve(scratch, "src/ui"), { recursive: true })
  await mkdir(resolve(scratch, "tests/ui"), { recursive: true })
  const paths = [
    ...sources.map((name) => `src/ui/${name}`),
    "tests/ui/Primitives.render.tsx"
  ]
  for (const path of paths) {
    const source = await readFile(resolve("apps/website", path), "utf8")
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
    entrypoints: [resolve(scratch, "tests/ui/Primitives.render.js")],
    target: "browser",
    minify: true,
    outdir: output,
    naming: "Primitives.js",
    define: { "process.env.NODE_ENV": JSON.stringify("production") }
  })
  assert.equal(built.success, true, JSON.stringify(built.logs))
  const css =
    (await readFile("apps/website/src/styles/Jobs.css", "utf8")) +
    "\n" +
    stylexPlugin.processStylexRules(rules)
  await writeFile(resolve(output, "Jobs.css"), css)
  const script = await readFile(resolve(output, "Primitives.js"))
  const axeScript = await readFile(require.resolve("axe-core/axe.min.js"))
  server = createServer((req, res) => {
    if (req.url === "/axe.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.end(axeScript)
    } else if (req.url === "/Primitives.js" || req.url === "/Jobs.css") {
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
        '<!doctype html><html lang="en"><head><title>Primitives fixture</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="fixture"></main><script type="module" src="/Primitives.js"></script></body></html>'
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
  page.on("pageerror", (error) => {
    errors.push(error.message)
    console.error("Browser error:", error.message)
  })
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      window.primitiveCsp = [...(window.primitiveCsp ?? []), event.violatedDirective]
    })
  )
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const action = page.locator("#action")
  await page.getByRole("button", { name: "Native action", exact: true }).click()
  await expect(action).toHaveText("refs passed")
  const native = page.locator("#native-button")
  await expect(native).toHaveAttribute("type", "button")
  await expect(native).toHaveAttribute("name", "operation")
  await expect(native).toHaveAttribute("value", "inspect")
  await expect(native).toHaveClass(/caller-button/)
  await expect(page.locator("#submits")).toHaveText("0")
  await page.getByRole("button", { name: "Submit", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#submits")).toHaveText("1")
  await page.getByLabel("Native input").fill("edited")
  await page.getByRole("button", { name: "Reset", exact: true }).click()
  await expect(page.getByLabel("Native input")).toHaveValue("original")
  await expect(page.getByRole("button", { name: "Disabled action" })).toBeDisabled()
  await page.getByRole("button", { name: "Disabled action" }).dispatchEvent("click")
  await expect(page.locator("#disabled-clicks")).toHaveText("0")
  checks.push("native Button props/type/ref, Panel ref, submit/reset/disabled semantics")
  const all = page.getByRole("tab", { name: /All jobs\s*120/ })
  const pending = page.getByRole("tab", { name: /Pending\s*32/ })
  await all.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: "Dead", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.locator("#activations")).toHaveText("0")
  await page.keyboard.press("ArrowRight")
  await expect(pending).toBeFocused()
  await expect(all).toHaveAttribute("aria-selected", "true")
  await expect(page.locator("#activations")).toHaveText("0")
  await page.keyboard.press("Enter")
  await expect(pending).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tabpanel", { name: /Pending/ })).toHaveText(
    "Pending results"
  )
  await page.keyboard.press("ArrowRight")
  await expect(all).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.locator("#activations")).toHaveText("2")
  checks.push(
    "manual controlled tabs: arrow focus includes discoverable disabled tab without action; Enter/Space activate, wrap, real linked panels and global count labels"
  )
  const trigger = page.getByRole("button", { name: "Exact timestamp", exact: true })
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("button", { name: "Close timestamp" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole("button", { name: "Close timestamp" }).click()
  await expect(action).toHaveText("popover refs passed")
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole("heading", { name: "Shared job controls" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  checks.push(
    "Popover keyboard open, dialog naming, refs, Close/Escape restore focus, outside dismissal"
  )
  const nav = page.getByRole("navigation", { name: "Pagination" }).first()
  await nav.getByRole("button", { name: "Page 2", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(action).toHaveText("page 2")
  await nav.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(nav.getByRole("button", { name: "Page 3", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(action).toHaveText("next")
  await nav.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(action).toHaveText("previous")
  await nav.getByRole("button", { name: "First page", exact: true }).click()
  await expect(action).toHaveText("first")
  await expect(
    nav.getByRole("button", { name: "Previous page", exact: true })
  ).toBeDisabled()
  await nav.getByRole("button", { name: "Page 9", exact: true }).click()
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled()
  const sparse = page.locator('[aria-label="Sparse known history"]')
  await expect(sparse.getByRole("button", { name: "Page 2", exact: true })).toHaveCount(0)
  await expect(sparse.locator('[aria-label="More known pages"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Toggle loading" }).click()
  await expect(nav).toHaveAttribute("aria-busy", "true")
  for (const button of await nav.getByRole("button").all()) {
    await expect(button).toBeDisabled()
  }
  checks.push(
    "Pagination actual known pages/current/ellipsis, native callbacks, first/previous/next bounds and loading disables every control"
  )
  const audit = async () => {
    await page.addScriptTag({ url: "/axe.js" })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ target }) => target)
      }))
    )
    assert.deepEqual(violations, [])
  }
  await audit()
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await audit()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  )
  assert.equal(await trigger.evaluate((node) => getComputedStyle(node).fontSize), "14px")
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true })
  csp.push(...(await page.evaluate(() => window.primitiveCsp ?? [])))
  assert.deepEqual(csp, [])
  assert.equal(await page.locator("style").count(), 0)
  checks.push(
    "desktop/mobile WCAG A/AA axe passes, 390px no overflow, body14, extracted CSS, strict CSP with no runtime style tags/violations"
  )
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  })
  const touch = await touchContext.newPage()
  await touch.goto(`http://127.0.0.1:${server.address().port}`)
  await touch.getByRole("button", { name: "Exact timestamp", exact: true }).tap()
  await expect(touch.getByRole("dialog")).toBeVisible()
  await expect(touch.getByRole("dialog")).toBeFocused()
  const bounds = await touch
    .getByRole("button", { name: "Exact timestamp", exact: true })
    .boundingBox()
  assert(bounds.height >= 44)
  await touch.getByRole("button", { name: "Close timestamp" }).tap()
  await expect(touch.getByRole("dialog")).toHaveCount(0)
  await touchContext.close()
  checks.push(
    "real touch context: trigger/close tap, popup initial focus, minimum44px target"
  )
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS",
        browser: browser.version(),
        inputs,
        cssSha256: hash(css),
        scriptSha256: hash(script),
        rules: rules.length,
        baseUI: "1.9.0",
        react: "19.3.0",
        checks,
        csp,
        errors
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ result: "PASS", checks }, null, 2))
} finally {
  await browser?.close()
  if (server) {
    await new Promise((done) => server.close(done))
  }
  await rm(scratch, { recursive: true, force: true })
}
