// Build/browser FFI. This is isolated UI qualification, not real API/PG routing.
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
const output = resolve("evidence/details-browser")
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve("apps/website/tests/ui/details/.browser-"))
const ui = [
  "Theme.stylex.ts",
  "Primitives.stylex.ts",
  "Primitives.tsx",
  "Popover.stylex.ts",
  "Popover.tsx",
  "DateTime.stylex.ts",
  "DateTime.tsx",
  "DateTimeFormat.ts"
]
const details = (await readdir("apps/website/src/features/jobs/details")).filter((name) =>
  /\.tsx?$/.test(name)
)
const paths = [
  ...ui.map((name) => `src/ui/${name}`),
  ...details.map((name) => `src/features/jobs/details/${name}`),
  "tests/ui/details/Details.render.tsx"
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
    entrypoints: [resolve(scratch, "tests/ui/details/Details.render.js")],
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
  const axe = await readFile(require.resolve("axe-core/axe.min.js"))
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
  const audit = async () => {
    await page.addScriptTag({ url: "/axe.js" })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target)
      }))
    )
    assert.deepEqual(violations, [])
  }
  await page.goto(`${origin}/jobs`)
  const trigger = page.getByRole("button", { name: "Inspect synthetic source" })
  await trigger.click()
  await expect(page.getByRole("dialog", { name: "Quick job details" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Close job details" })).toBeFocused()
  await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
  await expect(page.getByText("UNLOCKED SYNTHETIC SENTINEL")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(trigger).toBeFocused()
  assert.equal(await page.locator("html").getAttribute("data-slot-unmounts"), "1")
  await trigger.click()
  await expect(page.getByText("Locked synthetic payload")).toBeVisible()
  await audit()
  await page.getByRole("button", { name: "Close job details" }).click()
  await expect(trigger).toBeFocused()
  checks.push(
    "named Base UI dialog, initial focus, Escape/Close restoration and payload slot unmount/relock"
  )
  await trigger.click()
  await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
  await page.getByRole("button", { name: "Open full details" }).click()
  await expect(
    page.getByRole("heading", { name: "Job details", exact: true })
  ).toBeFocused()
  await expect(page.getByText("Locked synthetic payload")).toBeVisible()
  assert.match(page.url(), /\/jobs\/synthetic-source\?generation=1$/)
  await page.getByText("About counters & resolution", { exact: true }).click()
  await expect(
    page.getByText(
      "Source no longer retained; its payload, diff and history are unavailable.",
      { exact: false }
    )
  ).toBeVisible()
  await expect(page.locator('[aria-label="Handler result is not stored"]')).toBeVisible()
  await expect(page.locator('[aria-label="Handler result is not stored"]')).toHaveText(
    "—"
  )
  await expect(page.getByText("Attempts finalized", { exact: true })).toBeVisible()
  await audit()
  await page.screenshot({ path: resolve(output, "full-desktop.png"), fullPage: true })
  await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
  await page.getByRole("button", { name: "Open related job synthetic-successor" }).click()
  await expect(page.getByText("Locked synthetic payload")).toBeVisible()
  assert.match(page.url(), /\/jobs\/synthetic-successor\?generation=1$/)
  await page.goBack()
  await expect(trigger).toBeFocused()
  await expect(page.locator("#return-context")).toHaveText(
    "Page 3; Dead; synthetic.kind; fixture-3"
  )
  assert((await page.evaluate(() => scrollY)) > 0)
  assert.equal(await page.evaluate(() => history.state), null)
  checks.push(
    "full page and same-mode related routes, identity relock, real history Back with volatile filters/page/cursors/scroll/focus"
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await audit()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  )
  await page.screenshot({ path: resolve(output, "drawer-mobile.png"), fullPage: true })
  await page.getByRole("button", { name: "Open full details" }).click()
  await audit()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  )
  await page.screenshot({ path: resolve(output, "full-mobile.png"), fullPage: true })
  checks.push(
    "390px drawer/full page no horizontal overflow and desktop/mobile WCAG axe passes"
  )
  await page.goto(`${origin}/demo/jobs/synthetic-source?generation=1`)
  await expect(
    page.getByRole("heading", { name: "Job details", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Back to jobs" }).click()
  assert.equal(page.url(), `${origin}/demo`)
  await page.goto(`${origin}/demo/jobs/synthetic-source?generation=2`)
  await expect(page.getByRole("heading", { name: "Details unavailable" })).toBeVisible()
  await expect(page.getByText("UNLOCKED SYNTHETIC SENTINEL")).toHaveCount(0)
  checks.push(
    "direct demo detail/list fallback and stale generation never retargets identity"
  )
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS isolated UI (not real shared DTO/API/PG integration)",
        browser: browser.version(),
        inputs,
        cssSha256: hash(css),
        scriptSha256: hash(script),
        checks,
        errors,
        rules: rules.length
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ result: "PASS isolated UI", checks }, null, 2))
} finally {
  await browser?.close()
  if (server) {
    await new Promise((done) => server.close(done))
  }
  await rm(scratch, { recursive: true, force: true })
}
