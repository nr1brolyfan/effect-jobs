// Built static docs only. No backend, private data, or hosted qualification.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { createAssets } from "../../StaticAssets.mjs"
import { extractRegion } from "../../src/components/docs/ExtractExample.mjs"

const repository = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(resolve(repository, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const evidence = resolve(
  repository,
  process.env.SITE_EVIDENCE_DIRECTORY ?? ".multica/evidence"
)
mkdirSync(evidence, { recursive: true })
const assets = createAssets({
  siteDirectory: resolve(repository, "apps/website/dist/site"),
  dashboard: {}
})
const server = createServer(async (request, response) => {
  const result = assets(new Request(`http://127.0.0.1${request.url}`))
  response.writeHead(result.status, Object.fromEntries(result.headers))
  response.end(Buffer.from(await result.arrayBuffer()))
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const browser = await chromium.launch({ headless: true })
const origin = `http://127.0.0.1:${server.address().port}`
const failures = []
try {
  // Parse the built artifact in Chromium: invalid paragraphs are repaired before
  // selectors run, so child structure (not `p p`) is the regression oracle.
  const artifactAudit = []
  const parser = await browser.newPage()
  const built = resolve(repository, "apps/website/dist/site")
  for (const file of readdirSync(built, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".html")
  )) {
    const html = readFileSync(resolve(built, file), "utf8")
    const audit = await parser.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html")
      return {
        sourceParagraphs: (html.match(/<p(?:\s|>)/g) ?? []).length,
        parsedParagraphs: doc.querySelectorAll("p").length,
        emptyParagraphs: [...doc.querySelectorAll(".sl-markdown-content p")].filter(
          (p) => !p.textContent.trim()
        ).length,
        blockInParagraph: doc.querySelectorAll("p :is(p,div,ul,ol,pre,section)").length
      }
    }, html)
    if (process.env.SITE_TYPOGRAPHY_BASELINE !== "1") {
      assert.equal(
        audit.parsedParagraphs,
        audit.sourceParagraphs,
        `${file}: parser must not create repaired paragraphs`
      )
      assert.equal(audit.emptyParagraphs, 0, `${file}: no stray empty paragraphs`)
      assert.equal(audit.blockInParagraph, 0, `${file}: valid prose content`)
    }
    artifactAudit.push({ file, ...audit })
  }
  await parser.close()
  writeFileSync(
    `${evidence}/artifact-audit.json`,
    JSON.stringify(artifactAudit, null, 2) + "\n"
  )
  const typography = []
  const baseline = process.env.SITE_TYPOGRAPHY_BASELINE === "1"
  const inspectTypography = () => {
    const box = (element) => {
      if (!element) {
        return null
      }
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    const article = document.querySelector(".sl-markdown-content")
    const paragraphs = [...article.querySelectorAll(":scope > p")].map((p) => {
      const style = getComputedStyle(p)
      const range = document.createRange()
      range.selectNodeContents(p)
      return {
        text: p.textContent,
        box: box(p),
        whiteSpace: style.whiteSpace,
        maxWidth: style.maxWidth,
        textWrap: style.textWrap,
        lines: new Set([...range.getClientRects()].map((r) => Math.round(r.y))).size,
        breaks: p.querySelectorAll("br").length
      }
    })
    return {
      viewport: innerWidth,
      article: box(article),
      heading: box(document.querySelector("h1")),
      headings: [...article.querySelectorAll(":scope > .sl-heading-wrapper")].map(box),
      code: box(article.querySelector(".expressive-code")),
      toc: box(document.querySelector(".right-sidebar-container")),
      overflow: document.documentElement.scrollWidth > innerWidth,
      paragraphs,
      rows: [...article.querySelectorAll(".ej-outcome-list > div")].map((row) => ({
        box: box(row),
        tags: [...row.children].map((c) => c.tagName),
        texts: [...row.children].map((c) => c.textContent.trim()),
        label: box(row.firstElementChild),
        description: box(row.children[1]),
        paragraphs: row.querySelectorAll("p").length,
        empty: [...row.querySelectorAll("p")].filter((p) => !p.textContent.trim()).length,
        nestedBlocks: row.querySelectorAll("p :is(p,div,ul,ol,pre,section)").length
      }))
    }
  }
  const assertTypography = (value) => {
    assert.equal(value.overflow, false, "page overflow")
    assert.ok(Math.abs(value.heading.x - value.article.x) < 1, "shared title start")
    for (const heading of value.headings) {
      assert.ok(Math.abs(heading.x - value.article.x) < 1, "shared heading start")
    }
    if (value.code) {
      assert.ok(Math.abs(value.code.x - value.article.x) < 1, "shared code start")
    }
    for (const p of value.paragraphs) {
      assert.equal(p.whiteSpace, "normal", "normal prose whitespace")
      assert.equal(p.textWrap, "wrap", "natural prose wrap")
      assert.equal(p.maxWidth, "none", "no secondary prose measure")
      assert.equal(p.breaks, 0, "no manual prose line breaks")
      assert.ok(Math.abs(p.box.width - value.article.width) < 1, "prose fills article")
    }
    if (value.rows.length) {
      assert.equal(value.rows.length, 3)
    }
    for (const row of value.rows) {
      assert.deepEqual(
        row.tags,
        ["STRONG", "DIV"],
        "exact label and prose cell; no parser repairs"
      )
      assert.ok(row.texts.every(Boolean), "no empty grid cells")
      assert.equal(row.paragraphs, 1, "one description paragraph")
      assert.equal(row.empty, 0)
      assert.equal(row.nestedBlocks, 0)
      const stacked = value.viewport < 800 || value.article.width <= 608
      if (stacked) {
        assert.ok(row.description.y >= row.label.bottom - 1, "stacked description")
        assert.ok(
          Math.abs(row.description.width - row.box.width) < 1,
          "full stacked width"
        )
      } else {
        assert.ok(
          row.description.x >= row.label.right + 18,
          "description in second track"
        )
        assert.ok(row.description.width > 300, "Unknown must not occupy label track")
        assert.ok(Math.abs(row.description.right - row.box.right) < 1)
      }
    }
    if (value.viewport >= 1152) {
      assert.ok(value.toc.x >= value.article.right + 30, "TOC has its own track")
    }
  }
  for (const route of [
    "persistence/transactions",
    "start/tutorial",
    "start/first-job",
    "start/why-background-jobs"
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1000 },
      reducedMotion: "reduce"
    })
    page.on("pageerror", (error) => failures.push(error.message))
    const response = await page.goto(origin + "/docs/" + route)
    assert.equal(
      await response.text(),
      readFileSync(
        resolve(repository, "apps/website/dist/site/docs", route, "index.html"),
        "utf8"
      ),
      "HTTP serves exact built artifact"
    )
    await page.evaluate(() => document.fonts.ready)
    for (const width of [1920, 1440, 1024, 390, 1100, 1040, 980, 440, 360]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 })
      const value = await page.evaluate(inspectTypography)
      value.route = route
      typography.push(value)
      if (!baseline) {
        assertTypography(value)
      }
      if (route !== "start/why-background-jobs") {
        const panel = page.locator(".expressive-code").first()
        const sourceByRoute = {
          "persistence/transactions": ["apps/api/src/orders/PlaceOrder.ts", "request"],
          "start/tutorial": ["apps/api/src/orders/Orders.ts", "request"],
          "start/first-job": ["apps/api/src/orders/Orders.ts", "request"]
        }
        const [sourcePath, region] = sourceByRoute[route]
        const expected = extractRegion(
          readFileSync(
            resolve(repository, "apps/website/examples/docs/orders", sourcePath),
            "utf8"
          ),
          region
        )
        await expect(panel.locator(".title")).toHaveText(sourcePath)
        await expect(page.locator(".ej-code-role").first()).toBeVisible()
        const rendered = await panel.locator(".ec-line .code").allTextContents()
        assert.equal(
          rendered
            .map((line) => line.replaceAll("\u200b", "").replaceAll("\n", ""))
            .join("\n"),
          expected,
          "snippet indentation and logical blank lines"
        )
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
        await panel.getByRole("button", { name: "Copy to clipboard" }).click()
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          expected,
          "actual source copy"
        )
        value.codeStyle = await panel
          .locator(".code")
          .first()
          .evaluate((code) => {
            const style = getComputedStyle(code)
            return {
              whiteSpace: style.whiteSpace,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              padding: style.padding
            }
          })
      }
      const labels = await page
        .locator(".expressive-code .header .title")
        .evaluateAll((elements) =>
          elements
            .filter((e) => e.getBoundingClientRect().width > 0)
            .map((e) => ({
              text: e.textContent,
              scrollHeight: e.scrollHeight,
              clientHeight: e.clientHeight,
              scrollWidth: e.scrollWidth,
              clientWidth: e.clientWidth
            }))
        )
      for (const label of labels) {
        assert.ok(
          label.scrollHeight <= label.clientHeight + 1,
          `fully readable file label: ${label.text}`
        )
        assert.ok(
          label.scrollWidth <= label.clientWidth + 1,
          `wrapped file label: ${label.text}`
        )
      }
      await page.evaluate(() => {
        scrollTo(0, 0)
        return new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
      })
      if ([1920, 1440, 1024, 390].includes(width)) {
        await page.screenshot({
          path: `${evidence}/${route.replaceAll("/", "-")}-${width}-prose.png`
        })
        if (await page.locator(".expressive-code").count()) {
          await page
            .locator(".expressive-code")
            .first()
            .evaluate((panel) => {
              panel.scrollIntoView({ block: "start" })
              scrollBy(0, -145)
            })
          await page.screenshot({
            path: `${evidence}/${route.replaceAll("/", "-")}-${width}-code.png`
          })
        }
        const middle = page.locator(".sl-markdown-content > .sl-heading-wrapper").nth(1)
        if (await middle.count()) {
          await middle.evaluate((heading) => {
            heading.scrollIntoView({ block: "start" })
            scrollBy(0, -145)
          })
          await page.screenshot({
            path: `${evidence}/${route.replaceAll("/", "-")}-${width}-middle.png`
          })
        }
        if (route === "start/tutorial") {
          await page
            .locator('[data-job-visual="handoff"]')
            .screenshot({ path: `${evidence}/order-flow-${width}.png` })
        }
        if (value.rows.length) {
          await page
            .locator(".ej-outcome-list > div")
            .last()
            .evaluate((row) => row.scrollIntoView({ block: "center" }))
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
              )
          )
          await page.screenshot({ path: `${evidence}/unknown-${width}.png` })
          await page.evaluate(() => scrollTo(0, 0))
        }
      }
    }
    if (!baseline) {
      const variations = typography.filter(
        (v) => v.route === route && [1100, 1040, 980].includes(v.viewport)
      )
      assert.equal(
        new Set(variations.map((v) => Math.round(v.paragraphs[0].box.width))).size,
        3,
        "prose width follows available track"
      )
      assert.ok(
        new Set(variations.map((v) => v.paragraphs.map((p) => p.lines).join(","))).size >
          1,
        "natural line reflow at nearby widths"
      )
    }
    if (route === "persistence/transactions" && !baseline) {
      await page.setViewportSize({ width: 1920, height: 1000 })
      const original = await page.locator(".ej-outcome-list").innerHTML()
      await page
        .locator(".ej-outcome-list > div")
        .last()
        .evaluate((row) => {
          row.innerHTML =
            "<strong>Commit outcome Unknown</strong><p><p>A lost response does not prove rollback.</p></p>"
        })
      const repaired = await page.evaluate(inspectTypography)
      assert.throws(
        () => assertTypography(repaired),
        /exact label and prose cell/,
        "old nested markup negative control"
      )
      await page.locator(".ej-outcome-list").evaluate((list, html) => {
        list.innerHTML = html
      }, original)
      const narrow = await page.addStyleTag({
        content: ".sl-markdown-content > p { width: min(100%, 38rem) !important; }"
      })
      const badWidth = await page.evaluate(inspectTypography)
      assert.throws(
        () => assertTypography(badWidth),
        /prose fills article/,
        "old narrow prose negative control"
      )
      await narrow.evaluate((element) => element.remove())
    }
    await page.close()
  }
  for (const route of [
    "persistence/transactions",
    "start/tutorial",
    "start/first-job",
    "start/why-background-jobs"
  ]) {
    const noJs = await browser.newPage({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 }
    })
    await noJs.goto(origin + "/docs/" + route)
    await expect(noJs.getByRole("heading", { level: 1 })).toBeVisible()
    if (!baseline) {
      assertTypography(await noJs.evaluate(inspectTypography))
    }
    await noJs.close()
  }
  writeFileSync(
    `${evidence}/typography.json`,
    JSON.stringify(
      {
        baseline,
        typography,
        negativeControls: baseline
          ? "not run"
          : "parser-repaired nested paragraph and 38rem prose both rejected"
      },
      null,
      2
    ) + "\n"
  )
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" })
    page.on("pageerror", (error) => failures.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") {
        failures.push(message.text())
      }
    })
    await page.goto(origin + "/docs")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Durable jobs, explicit ownership"
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark"
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused()
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await page.locator("#starlight__search input").fill("durable")
    await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused()
    const contrast = await page.evaluate(() => {
      const luminance = (color) => {
        const values = color
          .match(/[0-9.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4
          })
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
      }
      const style = getComputedStyle(document.body)
      const foreground = luminance(style.color)
      const background = luminance(style.backgroundColor)
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      )
    })
    assert.ok(contrast >= 4.5, "body text contrast")
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2"
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "200% zoom overflow"
    )
    await page.evaluate(() => {
      document.documentElement.style.zoom = ""
    })
    await page.screenshot({
      path: `${evidence}/docs-${viewport.width}.png`,
      fullPage: true
    })
    await page.close()
  }
  const page = await browser.newPage({ javaScriptEnabled: false })
  await page.goto(origin + "/docs")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "Understand the problem" })).toBeVisible()
  await page.close()
  assert.deepEqual(failures, [])
  writeFileSync(
    `${evidence}/browser.json`,
    JSON.stringify(
      {
        desktop: "PASS",
        mobile: "PASS",
        keyboard: "PASS",
        reducedMotion: "PASS",
        noJs: "PASS",
        search: "PASS",
        zoom: "PASS (200%)",
        contrast: "PASS (body text >=4.5:1)",
        errors: failures
      },
      null,
      2
    ) + "\n"
  )
  console.log(
    "PASS: built docs desktop/mobile, keyboard, reduced motion, no-JS and Pagefind search"
  )
} catch (error) {
  writeFileSync(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ errors: failures }, null, 2)
  )
  throw error
} finally {
  await browser.close()
  await new Promise((done) => server.close(done))
}
