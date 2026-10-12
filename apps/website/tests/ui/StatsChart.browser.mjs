// Finite browser regression over the real compiled UI fixture; HTTP/Playwright are test FFI.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"

// First run the original Browser.mjs oracle, which builds these exact assets.
const fixture = resolve(process.env.STATS_CHART_BROWSER_FIXTURE ?? ".")
const require = createRequire(resolve(fixture, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(fixture, ".multica/ui-browser")
const assets = {
  "/BrowserEntry.js": await readFile(resolve(output, "BrowserEntry.js")),
  "/Jobs.css": await readFile(resolve(output, "Jobs.css")),
  "/jobs": (
    await readFile(
      resolve(fixture, "apps/website/src/features/jobs/Fixture.html"),
      "utf8"
    )
  ).replace("/FixtureEntry.js", "/BrowserEntry.js")
}
const server = createServer((request, response) => {
  const asset = assets[request.url]
  if (asset === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  response.setHeader(
    "content-type",
    request.url.endsWith(".js")
      ? "text/javascript"
      : request.url.endsWith(".css")
        ? "text/css"
        : "text/html"
  )
  response.end(asset)
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs`)
  await expect(page.locator(".connection-status")).toContainText("connected")
  const chart = page.getByRole("region", { name: "Job distribution" })
  const labels = ["Completed", "Active", "Pending", "Retry scheduled", "Dead", "Isolated"]
  for (const width of [1280, 390, 240]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(chart.locator("svg.recharts-surface")).toBeVisible()
    await expect(chart.locator("g.recharts-pie")).toHaveAttribute("tabindex", "-1")
    assert.equal(
      await chart
        .locator('[aria-hidden="true"] [tabindex]')
        .evaluateAll((nodes) => nodes.filter((node) => node.tabIndex >= 0).length),
      0
    )
    await expect(
      chart.getByRole("list", { name: "Jobs by state" }).getByRole("listitem")
    ).toHaveCount(6)
    const rows = await chart.getByRole("listitem").allTextContents()
    labels.forEach((label, index) => assert(rows[index].startsWith(label)))
    assert.match(await chart.innerText(), /13\s*Total jobs/)
    const box = await chart.locator("svg.recharts-surface").boundingBox()
    assert(box.width > 0 && box.width <= 220 && box.height > 0)
    const fills = await chart
      .locator("path.recharts-sector")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("fill")))
    assert(fills.length > 0)
    assert(
      fills.every((fill) =>
        ["#c7e89f", "#8ebed6", "#8e9b83", "#dfbd77", "#da9999", "#b7a0d5"].includes(fill)
      )
    )
  }
  // Bracket the chart with two real tab stops, then test the browser's tab order.
  await chart.evaluate((node) => {
    for (const [id, position] of [
      ["before-chart", "beforebegin"],
      ["after-chart", "afterend"]
    ]) {
      const button = document.createElement("button")
      button.id = id
      button.textContent = id
      node.insertAdjacentElement(position, button)
    }
  })
  await page.locator("#before-chart").focus()
  await page.keyboard.press("Tab")
  await expect(page.locator("#after-chart")).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(page.locator("#before-chart")).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 900 })
  await chart.scrollIntoViewIfNeeded()
  await expect(chart.locator("svg.recharts-surface")).toHaveAttribute("width", "220")
  const box = await chart.locator("svg.recharts-surface").boundingBox()
  // Hover within the ring rather than the transparent center of a sector's box.
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2)
  await expect(chart.locator(".recharts-tooltip-wrapper")).toBeVisible()
  await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText(/jobs · \d+%/)
  for (const reducedMotion of ["reduce", "no-preference"]) {
    await page.emulateMedia({ reducedMotion })
    await expect(chart.locator("g.recharts-pie")).toHaveAttribute("tabindex", "-1")
  }
  assert.deepEqual(errors, [])
  console.log(
    `PASS: Chromium ${browser.version()}; chart DOM, six-state legend/total/palette, responsive SVG, bidirectional Tab exclusion, pointer tooltip and motion preferences`
  )
} finally {
  await browser?.close()
  await new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
