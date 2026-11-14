// Portable default: normal dependencies + dist/site (or allowed native builddir).
// No task baseline or historical image is required. Optional owner evidence mode:
// DOCS_ALIGNMENT_PRESERVATION_MANIFEST=/path/approved.json (see Preservation.mjs).
// DOCS_ALIGNMENT_EVIDENCE_DIRECTORY redirects reports only, never served inputs.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { extname, resolve } from "node:path"
import { createRequire } from "node:module"
import { readOwnerPreservation, compareOwnerLanding } from "./Preservation.mjs"

const require = createRequire(resolve("apps/website/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(
  process.env.DOCS_ALIGNMENT_BUILD_DIRECTORY ?? "apps/website/dist/site"
)
assert(
  [
    resolve("apps/website/dist/site"),
    resolve("apps/website/dist/hosting/client")
  ].includes(output)
)
const evidence = resolve(
  process.env.DOCS_ALIGNMENT_EVIDENCE_DIRECTORY ?? ".multica/docs-landing-alignment",
  output.endsWith("/client") ? "native-browser" : "browser"
)
await mkdir(evidence, { recursive: true })
const preservation =
  process.env.DOCS_ALIGNMENT_PRESERVATION_MANIFEST === undefined
    ? null
    : await readOwnerPreservation(process.env.DOCS_ALIGNMENT_PRESERVATION_MANIFEST)
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
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".svg": "image/svg+xml",
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
const results = {
  output,
  scope: "portable docs and current-page landing style comparison",
  ownerPreservation: preservation
    ? {
        status: "PENDING",
        manifest: preservation.manifest,
        sourceChecks: preservation.sourceChecks,
        screenshots: []
      }
    : {
        status: "NOT_REQUESTED",
        detail:
          "No approved-before source/image comparison was run; current landing is captured for computed-style comparison only."
      },
  port,
  landing: [],
  routes: [],
  styleComparison: [],
  screenshots: [],
  errors: [],
  violations: []
}
let browser
const typography = (node) => {
  const style = getComputedStyle(node)
  return {
    font: style.fontFamily,
    size: style.fontSize,
    lineHeight: style.lineHeight,
    color: style.color,
    background: style.backgroundColor,
    radius: style.borderBottomRightRadius,
    border: style.borderBottomColor
  }
}
try {
  browser = await chromium.launch({ headless: true })
  results.chromium = browser.version()
  const origin = `http://127.0.0.1:${port}`
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      colorScheme: "light",
      reducedMotion: "reduce"
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
    const page = await context.newPage()
    page.on("pageerror", (error) => results.errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") {
        results.errors.push(message.text())
      }
    })
    const shot = async (label, locator, fullPage = true) => {
      const name = `${width}-${label}.png`
      if (locator) {
        await locator.screenshot({ path: resolve(evidence, name) })
      } else {
        await page.screenshot({ path: resolve(evidence, name), fullPage })
      }
      results.screenshots.push(name)
    }
    const overflow = async () =>
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
    const openMenu = async () => {
      if (width < 800) {
        const toggle = page.getByRole("button", { name: /menu/i })
        if ((await toggle.getAttribute("aria-expanded")) !== "true") {
          await toggle.click()
        }
      }
    }
    await page.goto(origin)
    await expect(page.locator(".stage-button")).toHaveCount(9)
    await page.evaluate(() => document.fonts.ready)
    const landing = {
      width,
      body: await page.locator("body").evaluate(typography),
      heading: await page.locator("#transaction-title").evaluate(typography),
      code: await page.locator(".code-panel pre").first().evaluate(typography),
      panel: await page.locator(".code-panel").first().evaluate(typography),
      header: await page.locator(".file-label").first().evaluate(typography),
      accent: await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
      ),
      tokens: await page.locator(".code-panel pre span[style]").evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            text: node.textContent.trim(),
            color: getComputedStyle(node).color
          }))
          .filter((token) => token.text)
      )
    }
    await shot("landing-full")
    await shot("landing-hero", null, false)
    landing.fullSha256 = sha(
      await readFile(resolve(evidence, `${width}-landing-full.png`))
    )
    if (preservation && width !== 320) {
      results.ownerPreservation.screenshots.push(
        await compareOwnerLanding(preservation, width, {
          full: resolve(evidence, `${width}-landing-full.png`),
          hero: resolve(evidence, `${width}-landing-hero.png`)
        })
      )
    }
    results.landing.push(landing)
    await page.goto(origin + "/docs")
    await expect(page.locator("h1")).toBeVisible()
    await shot("docs-full")
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused()
    await page.keyboard.press("Enter")
    await openMenu()
    const defining = page.getByRole("link", { name: "Defining jobs", exact: true })
    await expect(defining).toHaveAttribute("href", "/docs/reference/definitions")
    await defining.click()
    await expect(page).toHaveURL(origin + "/docs/reference/definitions")
    await expect(page.locator("h1")).toHaveText("Definitions and production")
    await expect(page.locator('.ej-nav-group a[aria-current="page"]')).toHaveCount(1)
    await expect(page.locator('.ej-nav-group a[aria-current="page"]')).toHaveText(
      "Defining jobs"
    )
    assert.equal(await page.evaluate(() => location.hash), "")
    await shot("definitions-full")
    if (width < 800) {
      const table = page.locator(".sl-markdown-content table").first()
      await table.focus()
      await expect(table).toBeFocused()
      await page.keyboard.press("ArrowRight")
      await expect
        .poll(() => table.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0)
      await table.evaluate((node) => {
        node.scrollLeft = node.scrollWidth
      })
      await shot("reference-local-scroll", table)
    }
    await openMenu()
    await page.getByRole("link", { name: "Getting started", exact: true }).click()
    await expect(page).toHaveURL(origin + "/docs/start/tutorial")
    await expect(page.locator("h1")).toHaveText("Getting started")
    await expect(page.locator('.ej-nav-group a[aria-current="page"]')).toHaveText(
      "Getting started"
    )
    const tutorialBody = await page.locator("body").evaluate(typography)
    const heading = await page
      .locator(".sl-markdown-content h2")
      .first()
      .evaluate(typography)
    const code = await page
      .locator(".expressive-code pre > code")
      .first()
      .evaluate(typography)
    const panel = await page.locator(".expressive-code pre").first().evaluate(typography)
    const header = await page
      .locator(".expressive-code .frame .header")
      .first()
      .evaluate(typography)
    const headerPaint = await page
      .locator(".expressive-code .frame .header")
      .first()
      .evaluate((node) => ({
        before: getComputedStyle(node, "::before").backgroundColor,
        title: getComputedStyle(node.querySelector(".title")).backgroundColor,
        frame: getComputedStyle(node.closest(".frame")).backgroundColor,
        gradient: getComputedStyle(node).backgroundImage,
        height: node.getBoundingClientRect().height
      }))
    await shot("code-panel", page.locator(".expressive-code").first())
    const tokens = await page
      .locator(".expressive-code .ec-line span[style]")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            text: node.textContent.trim(),
            color: getComputedStyle(node).color
          }))
          .filter((token) => token.text)
      )
    const common = ["const", "yield", "function", '"orders"'].flatMap((text) => {
      const left = landing.tokens.find((token) => token.text === text)
      const right = tokens.find((token) => token.text === text)
      return left && right ? [{ text, landing: left.color, docs: right.color }] : []
    })
    assert(common.length >= 2)
    for (const token of common) {
      assert.equal(token.docs, token.landing, token.text)
    }
    assert(new Set(tokens.map((token) => token.color)).size >= 4)
    const normalPalette = [...new Set(landing.tokens.map((token) => token.color))]
    for (const color of normalPalette) {
      assert(
        tokens.some((token) => token.color === color),
        `Native Github Dark token: ${color}`
      )
    }
    assert.equal(tutorialBody.background, landing.body.background)
    assert.equal(tutorialBody.font, landing.body.font)
    assert.equal(tutorialBody.size, "16px")
    assert.equal(heading.font, landing.heading.font)
    assert(parseFloat(heading.size) >= 24 && parseFloat(heading.size) < 35)
    assert.equal(code.font, landing.code.font)
    assert.equal(code.size, "14px")
    assert.equal(code.lineHeight, landing.code.lineHeight)
    assert.equal(panel.background, landing.panel.background)
    assert.equal(panel.border, landing.panel.border)
    assert.equal(panel.radius, landing.panel.radius)
    assert.equal(header.background, landing.header.background)
    assert.equal(header.font, landing.header.font)
    assert.equal(header.size, landing.header.size)
    assert.equal(header.lineHeight, landing.header.lineHeight)
    assert.equal(headerPaint.title, landing.panel.background)
    assert(headerPaint.gradient.includes(landing.panel.background))
    assert(Math.abs(headerPaint.height - 44) < 0.5)
    const comparison = {
      width,
      body: tutorialBody,
      heading,
      code,
      panel,
      header,
      headerPaint,
      commonTokens: common,
      tokenColors: [...new Set(tokens.map((token) => token.color))],
      responsivePadding: await page
        .locator(".expressive-code")
        .first()
        .evaluate((node) => ({
          inline: getComputedStyle(node).getPropertyValue("--ec-codePadInl").trim(),
          block: getComputedStyle(node).getPropertyValue("--ec-codePadBlk").trim()
        }))
    }
    results.styleComparison.push(comparison)
    await shot("code-panel", page.locator(".expressive-code").first())
    const copy = page.locator(".expressive-code .copy button").first()
    await expect(copy).toBeVisible()
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await copy.click()
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).includes("placeOrder")
    )
    const longCode = await page
      .locator(".expressive-code pre")
      .evaluateAll((nodes) =>
        nodes.findIndex((node) => node.scrollWidth > node.clientWidth + 10)
      )
    if (width < 800) {
      assert(longCode >= 0, "Long source has an intentional local scroller")
    }
    comparison.localCodeScrollTested = longCode >= 0
    if (longCode >= 0) {
      const scrollable = page.locator(".expressive-code pre").nth(longCode)
      await scrollable.focus()
      await expect(scrollable).toBeFocused()
      await page.keyboard.press("ArrowRight")
      await expect
        .poll(() => scrollable.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0)
    }
    for (const path of [
      "/docs",
      "/docs/start/tutorial",
      "/docs/reference/definitions",
      "/docs/reference/postgresql",
      "/docs/execution/workers",
      "/docs/persistence/postgresql",
      "/docs/persistence/drizzle"
    ]) {
      await page.goto(origin + path)
      await expect(page.locator("h1")).toBeVisible()
      assert.equal(
        (await page.locator("body").evaluate(typography)).background,
        "rgb(23, 23, 25)"
      )
      assert.equal(
        await page
          .locator("body")
          .evaluate(
            (node) =>
              node.textContent.includes("Durable by design") ||
              node.textContent.includes("Effect-native. PostgreSQL-backed.")
          ),
        false
      )
      await expect(page.locator(".ej-nav-intro, .ej-nav-footer")).toHaveCount(0)
      await overflow()
      assert(
        await page
          .locator(".expressive-code pre > code")
          .evaluateAll((nodes) =>
            nodes.every((node) => parseFloat(getComputedStyle(node).fontSize) >= 14)
          )
      )
      assert.equal(
        await page
          .locator(".ej-header")
          .evaluate((node) => getComputedStyle(node).display),
        "flex"
      )
      assert.equal(
        await page
          .locator(".ej-wordmark")
          .evaluate((node) => getComputedStyle(node).textDecorationLine),
        "none"
      )
      if (path === "/docs") {
        const shared = page.locator('link[rel="stylesheet"][href*="/Playback."]')
        await expect(shared).toHaveCount(1)
        await shared.evaluate((node) => {
          node.disabled = true
        })
        await expect(page.locator(".ej-header")).not.toHaveCSS("display", "flex")
        await shared.evaluate((node) => {
          node.disabled = false
        })
        await expect(page.locator(".ej-header")).toHaveCSS("display", "flex")
        await page.keyboard.press("Control+k")
        await expect(page.locator("site-search dialog")).toBeVisible()
        await page.locator(".pagefind-ui__search-input").fill("transaction")
        await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible({
          timeout: 15000
        })
        await page.keyboard.press("Escape")
        await expect(page.locator("site-search dialog")).toBeHidden()
        await shot("docs-full")
      }
      if (path === "/docs/start/tutorial") {
        const visual = page.locator("job-visual").first()
        await visual.scrollIntoViewIfNeeded()
        await expect(visual).not.toHaveAttribute("data-step", "final")
        assert(
          await visual
            .locator("code")
            .evaluateAll((nodes) =>
              nodes.every((node) => parseFloat(getComputedStyle(node).fontSize) >= 14)
            )
        )
        await shot("tutorial-illustration", visual)
        for (const diagram of await page.locator("job-visual").all()) {
          await diagram.scrollIntoViewIfNeeded()
          await expect(diagram).not.toHaveAttribute("data-step", "final")
          await diagram.locator('[data-action="reset"]').click()
          for (let step = 0; step < 12; step++) {
            const overflowNodes = await diagram
              .locator("div[data-node], .jv-row")
              .evaluateAll((nodes) =>
                nodes
                  .filter((node) => node.scrollWidth > node.clientWidth + 1)
                  .map((node) => ({
                    role: node.dataset.node ?? "row",
                    client: node.clientWidth,
                    scroll: node.scrollWidth,
                    text: node.textContent
                  }))
              )
            assert.deepEqual(
              overflowNodes,
              [],
              "Illustration values stay readable at every inspected stage"
            )
            await overflow()
            if (await diagram.locator('[data-action="step"]').isDisabled()) {
              break
            }
            await diagram.locator('[data-action="step"]').click()
          }
          await expect(diagram.locator('[data-action="step"]')).toBeDisabled()
          await shot(
            `tutorial-${await diagram.getAttribute("data-job-visual")}-final`,
            diagram
          )
        }
      }
      results.routes.push({
        width,
        path,
        title: await page.locator("h1").innerText(),
        expressiveCodeBlocks: await page.locator(".expressive-code").count(),
        codeOverflows: await page
          .locator(".expressive-code pre")
          .evaluateAll(
            (nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length
          )
      })
      results.violations.push(...(await page.evaluate(() => window.cspViolations)))
    }
    await page.goto(origin + "/docs/reference/definitions")
    if (width === 1440) {
      await page.locator('.right-sidebar starlight-toc a[href="#jobproducer"]').click()
      await expect(page).toHaveURL(origin + "/docs/reference/definitions#jobproducer")
    } else {
      await page.locator("mobile-starlight-toc summary").click()
      await page.locator('mobile-starlight-toc a[href="#jobproducer"]').click()
      await expect(page).toHaveURL(origin + "/docs/reference/definitions#jobproducer")
    }
    await shot("definitions-section", null, false)
    await page.goto(origin + "/docs/reference/definitions")
    if (width !== 1440) {
      await page.locator("mobile-starlight-toc summary").click()
    }
    const keyboardToc = page.locator(
      `${width === 1440 ? ".right-sidebar starlight-toc" : "mobile-starlight-toc"} a[href="#jobqueue"]`
    )
    await keyboardToc.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(origin + "/docs/reference/definitions#jobqueue")
    await shot("definitions-keyboard-section", null, false)
    await context.close()
  }
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 1000 },
      colorScheme: "light"
    })
    const page = await context.newPage()
    for (const path of ["/docs", "/docs/reference/definitions", "/docs/start/tutorial"]) {
      await page.goto(origin + path)
      await expect(page.locator("h1")).toBeVisible()
      assert.equal(
        (await page.locator("body").evaluate(typography)).background,
        "rgb(23, 23, 25)"
      )
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      await expect(
        page.getByRole("link", {
          name: "Defining jobs",
          exact: true,
          includeHidden: true
        })
      ).toHaveAttribute("href", "/docs/reference/definitions")
    }
    await context.close()
  }
  assert.deepEqual(results.errors, [])
  assert.deepEqual(results.violations, [])
  if (preservation) {
    assert.equal(results.ownerPreservation.screenshots.length, 2)
    results.ownerPreservation.status = "PASS"
  }
  results.status = "PASS"
} catch (error) {
  results.status = "FAILED"
  if (preservation) {
    results.ownerPreservation.status = "FAILED"
  }
  results.error = String(error.stack ?? error)
  throw error
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  results.serverStopped = !server.listening
  await writeFile(
    resolve(evidence, "results.json"),
    JSON.stringify(results, null, 2) + "\n"
  )
}
console.log(
  `PASS: portable docs/current-landing styles, dedicated definitions/current nav, 1440/390/320 reading/search/TOC, noJS/reduced/CSP, F1 negative control; owner preservation ${results.ownerPreservation.status}; server stopped.`
)
