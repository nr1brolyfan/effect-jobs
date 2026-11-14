// F1 integration regression: actual public bytes, emitted CSP and browser CSSOM.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { extname, resolve } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(resolve("apps/website/package.json"))
const { chromium, expect } = require("@playwright/test")
const before = process.argv.includes("--before")
const output = resolve("apps/website/dist/site")
const evidence = resolve(
  process.env.DOCS_EVIDENCE_DIRECTORY ?? ".multica/walkthrough-final/f1-correction",
  before ? "before" : "after"
)
await mkdir(evidence, { recursive: true })
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const policy = (await readFile(resolve(output, "_headers"), "utf8")).match(
  /Content-Security-Policy: (.*)/
)[1]
const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
    if (!extname(path)) {
      path = path.replace(/\/$/, "") + "/index.html"
    }
    const file = resolve(output, "." + path)
    assert(file.startsWith(output + "/"))
    response.setHeader("Content-Security-Policy", policy)
    response.setHeader(
      "content-type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".woff2": "font/woff2"
      }[extname(file)] ?? "application/octet-stream"
    )
    response.end(await readFile(file))
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const port = server.address().port
const result = {
  mode: before ? "REPRODUCE_F1" : "VERIFY_F1",
  output,
  indexSha256: sha(await readFile(resolve(output, "index.html"))),
  port,
  checks: [],
  errors: [],
  violations: []
}
let browser
try {
  browser = await chromium.launch({ headless: true })
  result.chromium = browser.version()
  const origin = `http://127.0.0.1:${port}`
  const assets = await readdir(resolve(output, "_astro"))
  const playback = assets.filter((file) => /^Playback\.[^/]+\.css$/.test(file))
  assert.equal(playback.length, 1, "One real Playback extraction recipient")
  const href = "/_astro/" + playback[0]
  const bytes = await readFile(resolve(output, "." + href))
  result.sharedAsset = { href, bytes: bytes.length, sha256: sha(bytes) }
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      colorScheme: "light"
    })
    await context.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) =>
        window.cspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI
        })
      )
    })
    try {
      const page = await context.newPage()
      page.on("pageerror", (error) => result.errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") {
          result.errors.push(message.text())
        }
      })
      const styles = () =>
        page.evaluate(() => ({
          header: getComputedStyle(document.querySelector(".ej-header")).display,
          wordmark: getComputedStyle(document.querySelector(".ej-wordmark"))
            .textDecorationLine
        }))
      await page.goto(origin + "/docs")
      await page.waitForLoadState("networkidle")
      const linked = await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))
      assert.equal(linked.filter((value) => value === href).length, 1)
      assert.equal(
        sha(Buffer.from(await (await page.request.get(origin + href)).body())),
        sha(bytes)
      )
      const actual = await styles()
      const check = { width, path: "/docs", linked, actual }
      result.checks.push(check)
      if (before) {
        assert.deepEqual(actual, { header: "block", wordmark: "underline" })
        const classes = await page
          .locator(".ej-header")
          .evaluate((node) => [...node.classList])
        const candidates = []
        for (const file of assets.filter(
          (name) => name.endsWith(".css") && name !== playback[0]
        )) {
          const css = await readFile(resolve(output, "_astro", file), "utf8")
          if (
            classes.some((name) => css.includes("." + name)) &&
            /display:\s*flex/.test(css)
          ) {
            candidates.push(file)
          }
        }
        assert(candidates.length > 0)
        const shared =
          candidates.find((file) => file.startsWith("TransactionFlow.")) ?? candidates[0]
        await page.addStyleTag({ url: origin + "/_astro/" + shared })
        check.positiveControl = await styles()
        check.positiveAsset = shared
        assert.deepEqual(check.positiveControl, { header: "flex", wordmark: "none" })
      } else {
        assert.deepEqual(actual, { header: "flex", wordmark: "none" })
        check.actualSharedRules = await page.evaluate((sharedHref) => {
          const sheet = [...document.styleSheets].find((value) =>
            value.href?.endsWith(sharedHref)
          )
          const found = []
          const visit = (rules) => {
            for (const rule of rules) {
              if (rule instanceof CSSStyleRule) {
                if (
                  document.querySelector(".ej-header").matches(rule.selectorText) &&
                  rule.style.display === "flex"
                ) {
                  found.push({
                    role: "header",
                    selector: rule.selectorText,
                    declaration: "display: flex"
                  })
                }
                if (
                  document.querySelector(".ej-wordmark").matches(rule.selectorText) &&
                  rule.style.textDecorationLine === "none"
                ) {
                  found.push({
                    role: "wordmark",
                    selector: rule.selectorText,
                    declaration: "text-decoration-line: none"
                  })
                }
              }
              if ("cssRules" in rule) {
                visit(rule.cssRules)
              }
            }
          }
          visit(sheet.cssRules)
          return found
        }, href)
        assert(check.actualSharedRules.some((rule) => rule.role === "header"))
        assert(check.actualSharedRules.some((rule) => rule.role === "wordmark"))
        const link = page.locator(`link[rel="stylesheet"][href="${href}"]`)
        await link.evaluate((node) => {
          node.disabled = true
        })
        await expect(page.locator(".ej-header")).not.toHaveCSS("display", "flex")
        check.disabled = await styles()
        assert.notEqual(
          check.disabled.header,
          "flex",
          "Actual linked extraction CSS must be necessary"
        )
        await page.screenshot({
          path: resolve(evidence, `${width}-docs-shared-disabled.png`),
          fullPage: true
        })
        await link.evaluate((node) => {
          node.disabled = false
        })
        await expect(page.locator(".ej-header")).toHaveCSS("display", "flex")
        check.restored = await styles()
        assert.deepEqual(check.restored, { header: "flex", wordmark: "none" })
      }
      await page.screenshot({
        path: resolve(evidence, `${width}-docs.png`),
        fullPage: true
      })
      if (!before) {
        await expect(page.locator("button[data-open-modal]")).toBeEnabled()
        await page.keyboard.press("Control+k")
        await expect(page.locator("site-search dialog")).toBeVisible()
        await page.locator(".pagefind-ui__search-input").fill("transaction")
        await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible({
          timeout: 15000
        })
        await page.keyboard.press("Escape")
        await expect(page.locator("site-search dialog")).toBeHidden()
        check.searchUnderEmittedCsp = true
        check.routes = []
        for (const path of [
          "/docs/start/tutorial",
          "/docs/start/why-background-jobs",
          "/docs/execution/workers"
        ]) {
          await page.goto(origin + path)
          assert.deepEqual(await styles(), { header: "flex", wordmark: "none" })
          if (path.includes("/start/")) {
            const illustration = page.locator("job-visual").first()
            await illustration.scrollIntoViewIfNeeded()
            await expect(illustration).not.toHaveAttribute("data-step", "final")
            assert.equal(
              await illustration
                .locator("svg")
                .first()
                .evaluate((node) => getComputedStyle(node).display),
              "block"
            )
            await page.screenshot({
              path: resolve(evidence, `${width}-${path.split("/").at(-1)}.png`),
              fullPage: true
            })
          }
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          )
          result.violations.push(...(await page.evaluate(() => window.cspViolations)))
          check.routes.push(path)
        }
      }
      result.violations.push(...(await page.evaluate(() => window.cspViolations)))
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.violations, [])
  result.status = before ? "F1_REPRODUCED" : "F1_CORRECTED"
} catch (error) {
  result.status = "FAILED"
  result.error = String(error.stack ?? error)
  throw error
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  result.serverStopped = !server.listening
  await writeFile(resolve(evidence, "docs.json"), JSON.stringify(result, null, 2) + "\n")
}
console.log(
  result.status +
    ": actual shared asset bytes, computed docs shell, stylesheet controls; server stopped"
)
