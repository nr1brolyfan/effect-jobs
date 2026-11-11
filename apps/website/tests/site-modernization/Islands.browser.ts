// Finite browser/HTTP FFI. No backend, credentials or external services.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, expect, type Locator } from "@playwright/test"
import { createAssets } from "../../../playground-worker/src/assets/StaticAssets.js"

// Expected palette is independent of renderer attributes and StyleX output.
const palette: Record<string, Record<string, readonly [number, string]>> = {
  overview: {
    save: [1, "rgb(100, 170, 255)"],
    claim: [3, "rgb(231, 189, 101)"],
    send: [4, "rgb(179, 154, 255)"]
  },
  transaction: { claim: [4, "rgb(231, 189, 101)"] },
  handoff: {
    confirmation: [1, "rgb(179, 154, 255)"],
    invoice: [1, "rgb(231, 189, 101)"],
    delivery: [3, "rgb(105, 198, 165)"]
  }
}
const colorChecks: unknown[] = []
const assertColors = async (
  visual: Locator,
  variant: string,
  step: number,
  enabled = true
) => {
  await expect(visual.locator(".jv-wires [style]")).toHaveCount(0)
  const colors = await visual.locator("[data-connection]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const packet = node.parentElement!.querySelector("[data-packet]")!
      const rectangle = getComputedStyle(packet.querySelector("rect")!)
      const text = getComputedStyle(packet.querySelector("text")!)
      const wire = getComputedStyle(node)
      return {
        id: node.getAttribute("data-connection")!,
        active: node.getAttribute("data-active"),
        stroke: wire.stroke,
        fill: wire.fill,
        marker: wire.markerEnd,
        packetStroke: rectangle.stroke,
        packetFill: rectangle.fill,
        textFill: text.fill
      }
    })
  )
  assert.equal(colors.length, Object.keys(palette[variant]!).length)
  for (const color of colors) {
    const [at, expected] = palette[variant]![color.id]!
    const active = enabled && step >= at
    assert.equal(color.active, String(active), `${variant}/${color.id} state`)
    assert.equal(
      color.stroke,
      active ? expected : "rgb(100, 107, 119)",
      `${variant}/${color.id} computed wire stroke at step ${step}`
    )
    assert.equal(color.fill, "none")
    assert.match(color.marker, /jv-arrow-/)
    assert.equal(color.packetStroke, expected, `${variant}/${color.id} packet border`)
    assert.equal(color.packetFill, "rgb(19, 21, 25)")
    assert.equal(color.textFill, expected, `${variant}/${color.id} packet text`)
  }
  colorChecks.push({ variant, step, enabled, colors })
}

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
  // Step exercises every active/inactive transition, including rollback suppression.
  for (const variant of variants) {
    const visual = page.locator(`[data-job-visual="${variant}"]`)
    if (variant === "transaction") {
      await visual.locator('[data-mode="commit"]').click()
    }
    await visual.locator("[data-action=reset]").click()
    await assertColors(visual, variant, 0)
    const maximum = variant === "transaction" ? 4 : 5
    for (let step = 1; step <= maximum; step++) {
      await visual.locator("[data-action=step]").click()
      await expect(visual).toHaveAttribute("data-step", String(step))
      await assertColors(visual, variant, step)
    }
    await visual.screenshot({ path: resolve(evidence, `${variant}-colors.png`) })

    // Real playback must show a correctly colored moving packet, then active wires.
    await visual.locator("[data-action=reset]").click()
    await visual.locator("[data-action=play]").click()
    if (variant === "transaction") {
      await expect(visual).toHaveAttribute("data-step", "3")
    }
    await expect
      .poll(() =>
        visual.locator("[data-packet]").first().getAttribute("opacity").then(Number)
      )
      .toBeGreaterThan(0.1)
    await assertColors(visual, variant, variant === "transaction" ? 3 : 0)
    await visual.screenshot({ path: resolve(evidence, `${variant}-packet.png`) })
    // Five natural 1.3s stages finish within this bound; no animation clock repair.
    await expect(visual).toHaveAttribute("data-step", String(maximum), {
      timeout: 10_000
    })
    await expect(visual).toHaveAttribute("data-playing", "false")
    await assertColors(visual, variant, maximum)
  }
  await transaction.locator('[data-mode="rollback"]').click()
  for (let step = 0; step <= 4; step++) {
    if (step > 0) {
      await transaction.locator("[data-action=step]").click()
    }
    await assertColors(transaction, "transaction", step, false)
  }
  await expect(transaction.locator('[data-label="workerState"]')).toHaveText("No job")
  await transaction.locator("[data-action=reset]").click()
  await transaction.locator("[data-action=play]").click()
  await expect(transaction).toHaveAttribute("data-step", "4", { timeout: 10_000 })
  await expect(transaction).toHaveAttribute("data-playing", "false")
  await assertColors(transaction, "transaction", 4, false)
  await expect(transaction.locator("[data-packet]")).toHaveAttribute("opacity", "0")
  await overview.locator("[data-action=reset]").click()
  await overview.locator("[data-action=step]").click()
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(overview.locator("[data-action=play]")).toBeHidden()
  await overview.locator("[data-action=step]").focus()
  await page.keyboard.press("Enter")
  await expect(overview).toHaveAttribute("data-step", "2")
  await assertColors(overview, "overview", 2)
  const focus = await overview
    .locator("[data-action=step]")
    .evaluate((node) => getComputedStyle(node).outlineStyle)
  assert.equal(focus, "solid")
  for (const variant of variants) {
    const visual = page.locator(`[data-job-visual="${variant}"]`)
    if (variant === "transaction") {
      await visual.locator('[data-mode="commit"]').click()
    }
    await visual.locator("[data-action=reset]").click()
    await expect(visual.locator("[data-action=play]")).toBeHidden()
    const maximum = variant === "transaction" ? 4 : 5
    for (let step = 1; step <= maximum; step++) {
      await visual.locator("[data-action=step]").click()
      await assertColors(visual, variant, step)
    }
    await visual.screenshot({ path: resolve(evidence, `${variant}-reduced.png`) })
  }
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
  for (const variant of variants) {
    const visual = staticPage.locator(`[data-job-visual="${variant}"]`)
    await expect(visual).toHaveAttribute("data-step", "final")
    await expect(visual.locator(".jv-static")).toBeVisible()
    await assertColors(visual, variant, 0)
  }
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
        colorChecks,
        checks: [
          "independent registries",
          "rollback",
          "computed wire and packet colors: every Step, Play, commit/rollback, reduced-motion and no-JS",
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
