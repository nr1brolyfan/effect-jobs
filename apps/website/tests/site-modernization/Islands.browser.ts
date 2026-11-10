// Finite browser/HTTP FFI. No backend, credentials or external services.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import { createAssets } from "../../../playground-worker/src/assets/StaticAssets.js"

const assets = createAssets({
  siteDirectory: resolve("apps/website/dist/site"),
  dashboard: {}
})
const server = createServer(async (request, response) => {
  const result = assets(new Request(`http://localhost${request.url}`))
  response.writeHead(result.status, Object.fromEntries(result.headers))
  response.end(Buffer.from(await result.arrayBuffer()))
})
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
assert(address && typeof address !== "string")
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
const evidence = resolve(".toolchain/site/browser")
await mkdir(evidence, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${origin}/docs/start/tutorial`)
  const variants = ["overview", "transaction", "handoff"]
  for (const variant of variants) {
    const visual = page.locator(`[data-job-visual="${variant}"]`)
    await visual.scrollIntoViewIfNeeded()
    await expect(visual.locator("[data-action=step]")).toBeVisible()
    await expect(visual).toHaveAttribute("data-step", "0")
  }
  const overview = page.locator('[data-job-visual="overview"]')
  await overview.locator("[data-action=step]").click()
  await expect(overview).toHaveAttribute("data-step", "1")
  const transaction = page.locator('[data-job-visual="transaction"]')
  await transaction.locator('[data-mode="rollback"]').click()
  for (let step = 0; step < 4; step++) {
    await transaction.locator("[data-action=step]").click()
  }
  await expect(transaction.locator('[data-label="workerState"]')).toHaveText("No job")
  await expect(transaction.locator('[data-label="order"]')).toHaveText("—")
  await expect(transaction.locator('[data-label="job"]')).toHaveText("—")
  await expect(overview).toHaveAttribute("data-step", "1")
  await expect(page.locator('[data-job-visual="handoff"]')).toHaveAttribute(
    "data-step",
    "0"
  )

  // Stable identities and geometry coexist across independently hydrated islands.
  const markers = await page
    .locator("job-visual marker")
    .evaluateAll((nodes) => nodes.map((node) => node.id))
  assert.equal(new Set(markers).size, markers.length)
  const geometry = await overview.locator("[data-connection]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      path: node.getAttribute("d"),
      length: (node as SVGPathElement).getTotalLength()
    }))
  )
  assert(geometry.every((item) => item.path && item.length > 0))
  await overview.screenshot({ path: resolve(evidence, "overview.png") })
  await transaction.screenshot({ path: resolve(evidence, "rollback.png") })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(overview.locator("[data-action=play]")).toBeHidden()
  await overview.locator("[data-action=step]").focus()
  await page.keyboard.press("Enter")
  await expect(overview).toHaveAttribute("data-step", "2")
  const focus = await overview
    .locator("[data-action=step]")
    .evaluate((node) => getComputedStyle(node).outlineStyle)
  assert.equal(focus, "solid")
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  await page.screenshot({ path: resolve(evidence, "docs-mobile.png"), fullPage: true })
  await expect(page.locator("style[data-stylex]")).toHaveCount(0)
  assert.deepEqual(errors, [])
  const noJs = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await noJs.newPage()
  await staticPage.goto(`${origin}/docs/start/tutorial`)
  await expect(
    staticPage.locator('[data-job-visual="overview"] [data-label="jobState"]')
  ).toHaveText("Completed")
  await expect(staticPage.locator(".jv-controls").first()).toBeHidden()
  await staticPage.goto(`${origin}/docs/jobs`)
  await expect(staticPage).toHaveURL(`${origin}/docs/playground`)
  await expect(staticPage.locator("h1")).toHaveText("Explore the jobs playground")
  await noJs.close()
  await writeFile(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        result: "PASS",
        browser: browser.version(),
        checks: [
          "independent registries",
          "rollback",
          "SVG geometry",
          "keyboard",
          "reduced motion",
          "320px",
          "no-JS final diagram",
          "legacy route"
        ]
      },
      null,
      2
    )
  )
  console.log(
    "PASS: independent Atom islands, geometry, rollback, keyboard, reduced motion, mobile and no-JS legacy route"
  )
} finally {
  await browser.close()
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
