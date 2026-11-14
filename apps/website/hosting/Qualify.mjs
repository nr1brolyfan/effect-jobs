// Finite real Workers asset-layer and Chromium qualification; no cloud writes.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir, mkdir, writeFile, lstat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import { Miniflare } from "miniflare"
import { chromium, expect } from "@playwright/test"

const website = fileURLToPath(new URL("../", import.meta.url))
const directory = join(website, "dist/hosting/client")
const evidence = resolve(website, "../../.multica/docs-hosting/implementation/workers")
await mkdir(evidence, { recursive: true })
const build = JSON.parse(await readFile(join(website, "dist/hosting-build.json"), "utf8"))
assert.equal(build.assetsOnly, true)
assert.equal(build.directory, directory)
const files = (await readdir(directory, { recursive: true })).sort()
const headers = await readFile(join(directory, "_headers"), "utf8")
const manifest = []
const htmlFiles = []
for (const file of files) {
  const path = join(directory, file)
  const stat = await lstat(path)
  assert.equal(stat.isSymbolicLink(), false, file)
  if (!stat.isFile()) {
    continue
  }
  assert.match(
    file,
    /^(?:_astro\/|pagefind\/|docs\/|404\.html$|index\.html$|favicon\.(?:svg|ico)$|apple-touch-icon\.png$|robots\.txt$|sitemap(?:-\d+|-index)?\.xml$|_headers$)/
  )
  assert.doesNotMatch(
    file,
    /^(?:api|jobs|demo)(?:\/|$)|(?:^|\/)(?:server|node_modules|\.env|\.alchemy)(?:\/|$)|\.(?:map|ts|tsx|pem|key)$/
  )
  const bytes = await readFile(path)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  manifest.push({ file, size: bytes.length, sha256 })
  if (file.endsWith(".html")) {
    htmlFiles.push(file)
    const html = bytes.toString()
    assert.doesNotMatch(html, /href="\/demo(?:["/#?])|href="\/jobs(?:["/#?])|alpha\.3/)
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(script[1]) && script[2]) {
        const hash = createHash("sha256").update(script[2]).digest("base64")
        assert.ok(
          headers.includes(`'sha256-${hash}'`),
          `${file}: final inline script hash`
        )
      }
    }
  }
}
await writeFile(
  join(evidence, "assets-sha256.json"),
  JSON.stringify(manifest, null, 2) + "\n"
)
// Miniflare v5 requires a module manifest even for assets-only configurations.
// This local trap is never uploaded and must never execute: asset misses use
// the native 404 layer, not a JavaScript handler or a test-owned file server.
const mf = new Miniflare({
  workers: [
    {
      config: {
        name: "docs",
        compatibilityDate: "2026-10-13",
        manifest: {
          mainModule: "trap.js",
          modules: {
            "trap.js": {
              type: "esm",
              contents:
                'export default {fetch(){throw Error("Unexpected user Worker execution")}}'
            }
          }
        },
        assets: {
          directory,
          hasUserWorker: false,
          htmlHandling: "drop-trailing-slash",
          notFoundHandling: "404-page"
        }
      }
    }
  ]
})
let browser
const observations = []
const failures = []
try {
  const origin = String(await mf.ready).replace(/\/$/, "")
  const request = (path, init) => mf.dispatchFetch(origin + path, init)
  for (const file of htmlFiles) {
    if (file === "404.html") {
      continue
    }
    const path =
      file === "index.html"
        ? "/"
        : "/" + file.replace(/\/index\.html$/, "").replace(/\.html$/, "")
    const response = await request(path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), await readFile(join(directory, file), "utf8"))
    assert.match(response.headers.get("content-type"), /^text\/html/)
    assert.match(
      response.headers.get("content-security-policy"),
      /script-src 'self' 'wasm-unsafe-eval'/
    )
    assert.doesNotMatch(
      response.headers.get("content-security-policy"),
      /(?:^|\s)'unsafe-eval'|script-src[^;]*'unsafe-inline'/
    )
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
    assert.equal(response.headers.get("x-frame-options"), "DENY")
    assert.match(response.headers.get("cache-control"), /max-age=0/)
    if (path !== "/docs/jobs") {
      assert.ok(
        (await readFile(join(directory, file), "utf8")).includes(
          `href="https://effect-jobs.dev${path}"`
        ),
        `canonical ${path}`
      )
    }
    observations.push({
      path,
      status: response.status,
      headers: Object.fromEntries(response.headers)
    })
  }
  for (const path of [
    "/absent",
    "/docs/absent",
    "/api/jobs",
    "/api/jobs/one",
    "/api/demo/jobs",
    "/jobs",
    "/jobs/private",
    "/demo",
    "/.env",
    "/alchemy.run.ts",
    "/_headers",
    "/dist/site/server/entry.mjs"
  ]) {
    const response = await request(path)
    assert.equal(response.status, 404, path)
    assert.equal(
      await response.text(),
      await readFile(join(directory, "404.html"), "utf8")
    )
    observations.push({ path, status: response.status })
  }
  assert.equal((await request("/api/jobs", { method: "POST" })).status, 405)
  const head = await request("/docs", { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  const slash = await request("/docs/", { redirect: "manual" })
  assert.equal(slash.status, 307)
  assert.equal(new URL(slash.headers.get("location"), origin).pathname, "/docs")
  const sitemap = await request("/sitemap-0.xml")
  const sitemapText = await sitemap.text()
  assert.match(sitemapText, /https:\/\/effect-jobs.dev\/docs/)
  assert.doesNotMatch(sitemapText, /localhost|\/404|\/demo|\/jobs</)
  assert.match(
    await (await request("/robots.txt")).text(),
    /Sitemap: https:\/\/effect-jobs.dev\/sitemap-index.xml/
  )
  for (const file of manifest.filter((item) =>
    /\.(?:css|js|wasm|woff2|svg|ico|png)$/.test(item.file)
  )) {
    const response = await request("/" + file.file)
    assert.equal(response.status, 200, file.file)
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(await response.arrayBuffer()))
        .digest("hex"),
      file.sha256
    )
    if (file.file.endsWith(".wasm")) {
      assert.equal(response.headers.get("content-type"), "application/wasm")
    }
    if (file.file === "favicon.ico") {
      assert.match(
        response.headers.get("content-type"),
        /^image\/(?:x-icon|vnd\.microsoft\.icon)$/
      )
    }
    if (file.file === "apple-touch-icon.png") {
      assert.equal(response.headers.get("content-type"), "image/png")
    }
    if (file.file.startsWith("_astro/")) {
      assert.match(response.headers.get("cache-control"), /max-age=31536000/)
      assert.doesNotMatch(response.headers.get("cache-control"), /max-age=0/)
    }
  }
  browser = await chromium.launch({ headless: true })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce"
    })
    const page = await context.newPage()
    page.on("pageerror", (error) => failures.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") {
        failures.push(message.text())
      }
    })
    await page.addInitScript(() => {
      globalThis.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) =>
        globalThis.cspViolations.push({
          directive: event.effectiveDirective,
          blockedURI: event.blockedURI
        })
      )
    })
    await page.goto(origin + "/")
    await expect(page.locator("h1")).toBeVisible()
    await expect(page.locator("[data-next], [data-toggle], [data-step]")).toHaveCount(0)
    const commit = page.getByRole("radio", { name: "Commit", exact: true })
    const rollback = page.getByRole("radio", { name: "Rollback", exact: true })
    await expect(commit).toBeChecked()
    await expect(page.locator("main")).toHaveAttribute("data-result", "saved")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(2)
    await rollback.check()
    await expect(rollback).toBeChecked()
    await expect(page.locator("main")).toHaveAttribute("data-result", "rolled-back")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
    await expect(page.locator("#handler .received-job")).toBeHidden()
    await commit.check()
    await expect(page.locator("main")).toHaveAttribute("data-result", "saved")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(2)
    await expect(page.locator("#handler .received-job")).toBeVisible()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.screenshot({
      path: join(evidence, `landing-${width}.png`),
      fullPage: true
    })
    assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), [])
    await page.goto(origin + "/docs")
    assert.equal(
      await page
        .locator(".ej-header")
        .evaluate((element) => getComputedStyle(element).display),
      "flex",
      "shared StyleX header layout"
    )
    assert.equal(
      await page
        .locator(".ej-wordmark")
        .evaluate((element) => getComputedStyle(element).textDecorationLine),
      "none",
      "shared StyleX wordmark"
    )
    if (width === 1440) {
      const header = await page.locator(".ej-header").boundingBox()
      const tools = await page.locator(".ej-header-tools").boundingBox()
      assert.ok(
        header && tools && tools.x > width / 2 && tools.y < header.y + header.height,
        "header tools stay in the navigation row"
      )
    }
    // Reproduce the missing-styles failure in the browser: this oracle must
    // reject the previously unstyled header before restoring the same asset.
    const sharedStyles = page.locator('link[rel="stylesheet"][href*="/Playback."]')
    await expect(sharedStyles).toHaveCount(1)
    await sharedStyles.evaluate((element) => {
      element.disabled = true
    })
    assert.notEqual(
      await page
        .locator(".ej-header")
        .evaluate((element) => getComputedStyle(element).display),
      "flex",
      "missing shared stylesheet negative control"
    )
    await sharedStyles.evaluate((element) => {
      element.disabled = false
    })
    assert.equal(
      await page
        .locator(".ej-header")
        .evaluate((element) => getComputedStyle(element).display),
      "flex"
    )
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused()
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await page.locator("#starlight__search input").fill("durable")
    await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), [])
    await page.screenshot({ path: join(evidence, `docs-${width}.png`), fullPage: true })
    // Axe is test-only injection, independent of production assets and CSP.
    const axe = await readFile(
      resolve(website, "../../node_modules/axe-core/axe.min.js"),
      "utf8"
    )
    await page.evaluate(axe)
    const accessibility = await page.evaluate(async () => {
      const result = await globalThis.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
      })
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target)
      }))
    })
    assert.deepEqual(accessibility, [], `docs accessibility at ${width}`)
    await page.goto(origin + "/docs/start/tutorial")
    await expect(page.locator("job-visual").first()).toBeVisible()
    assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), [])
    await context.close()
  }
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 }
  })
  for (const path of ["/", "/docs", "/docs/start/first-job", "/docs/playground"]) {
    const page = await noJs.newPage()
    await page.goto(origin + path)
    await expect(page.locator("h1")).toBeVisible()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.close()
  }
  await noJs.close()
  assert.deepEqual(failures, [])
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(
      {
        status: "PASS",
        htmlRoutes: htmlFiles.length - 1,
        assets: manifest.length,
        observations,
        browser: [
          "desktop",
          "mobile",
          "search/WASM",
          "landing hydrated Commit/Rollback; retired controls intentionally absent",
          "docs islands",
          "keyboard",
          "reduced motion",
          "no-JS",
          "WCAG axe"
        ],
        errors: failures
      },
      null,
      2
    ) + "\n"
  )
  console.log(
    "PASS: native Workers assets routes/404/headers/CSP, Chromium desktop/mobile/search/islands/accessibility"
  )
} catch (error) {
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify({ message: error.message, failures, observations }, null, 2)
  )
  console.error(failures)
  throw error
} finally {
  await browser?.close()
  await mf.dispose()
}
