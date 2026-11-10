// Finite browser qualification. Test-owned HTTP and Playwright are browser FFI.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve, extname } from "node:path"

const root = process.cwd()
const require = createRequire(resolve(root, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(process.env.LANDING_SITE_OUTPUT ?? "apps/website/dist/site")
const evidence = resolve(process.env.LANDING_EVIDENCE ?? ".toolchain/landing/browser")
await mkdir(evidence, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
    const file =
      path === "/__axe.js"
        ? require.resolve("axe-core/axe.min.js")
        : resolve(output, "." + (path === "/" ? "/index.html" : path))
    if (path !== "/__axe.js" && !file.startsWith(output + "/")) {
      throw new Error("Outside fixture")
    }
    const data = await readFile(file)
    response.setHeader(
      "content-type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2"
      }[extname(file)] ?? "application/octet-stream"
    )
    response.end(data)
  } catch {
    response.writeHead(404)
    response.end()
  }
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
  const base = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1100 }
  })
  const page = await context.newPage()
  const errors = []
  page.on(
    "pageerror",
    (error) => (errors.push(error.message), console.error(error.message))
  )
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) {
      errors.push(message.text())
    }
  })
  await page.goto(base)
  const system = page.locator("ej-job-system")
  await expect(page.locator("[data-next]")).toBeVisible()
  await expect(page.locator("[data-toggle]")).toBeDisabled()
  await expect(system).toHaveAttribute("data-playing", "false")
  await expect(page.locator("[data-code]")).toContainText("GenerateReport.enqueue")
  await expect(page.locator("[data-step]")).toHaveText("Step 1 / 12")
  const expectedStates = [
    ["Pending", "Awaiting request", "Awaiting request", "Awaiting request"],
    ["Active", "Pending", "Awaiting request", "Awaiting request"],
    ["Active", "Active", "Awaiting request", "Awaiting request"],
    ["Active", "Active", "Pending", "Pending"],
    ["Completed", "RetryScheduled", "Pending", "Pending"],
    ["Completed", "RetryScheduled", "Active", "Active"],
    ["Completed", "RetryScheduled", "Active", "Active"],
    ["Completed", "RetryScheduled", "Completed", "Active"],
    ["Completed", "RetryScheduled", "Completed", "Completed"],
    ["Completed", "Active", "Completed", "Completed"],
    ["Completed", "Active", "Completed", "Completed"],
    ["Completed", "Completed", "Completed", "Completed"]
  ]
  for (let step = 0; step < expectedStates.length; step++) {
    assert.deepEqual(
      await page.locator(".job .state").allTextContents(),
      expectedStates[step]
    )
    const active = expectedStates[step].filter((state) => state === "Active").length
    assert(active <= 2)
    await expect(page.locator("[data-capacity]")).toHaveText(`${active} / 2 active`)
    assert.equal(await page.locator('[data-worker][data-busy="true"]').count(), active)
    for (let job = 0; job < 4; job++) {
      await page.locator(`[data-job="${job}"]`).click()
      await expect(page.locator(`[data-job="${job}"]`)).toHaveAttribute(
        "aria-pressed",
        "true"
      )
      await expect(page.locator('[data-job][aria-pressed="true"]')).toHaveCount(1)
      const region = ["Pending", "Awaiting request"].includes(expectedStates[step][job])
        ? "enqueue"
        : "handler"
      const expectedCode = await page
        .locator(`[data-source="${region}"]`)
        .evaluate((node) => node.content.querySelector("code").textContent)
      assert.equal(await page.locator("[data-code]").textContent(), expectedCode)
    }
    if (step === 4) {
      await page.locator('[data-job="1"]').click()
      await expect(page.locator("[data-explanation]")).toContainText(
        "confirmed retryable failure"
      )
      await page.screenshot({
        path: resolve(evidence, "desktop-retry.png"),
        fullPage: true
      })
    }
    if (step === 9) {
      await expect(page.locator('[data-job="1"] [data-detail]')).toContainText(
        "attempt 2"
      )
    }
    if (step < expectedStates.length - 1) {
      await page.locator("[data-next]").click()
    }
  }
  await expect(page.locator("[data-next]")).toBeDisabled()
  await expect(page.locator("[data-toggle]")).toBeDisabled()
  await page.locator("[data-restart]").click()
  await expect(page.locator("[data-step]")).toHaveText("Step 1 / 12")
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const sizes = await page.evaluate(() => ({
      viewport: innerWidth,
      content: document.documentElement.scrollWidth
    }))
    assert(
      sizes.content <= sizes.viewport,
      `horizontal page overflow at ${width}: ${JSON.stringify(sizes)}`
    )
    await expect(page.locator("h1")).toBeVisible()
    if (width === 390) {
      await page.screenshot({ path: resolve(evidence, "mobile.png"), fullPage: true })
    }
  }
  // Equivalent to a 200% desktop zoom: halve CSS viewport, preserve readable content.
  await page.setViewportSize({ width: 640, height: 500 })
  await expect(page.locator(".job").first()).toBeVisible()
  await page.locator("[data-next]").focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("[data-step]")).toHaveText("Step 2 / 12")
  await page.keyboard.press("Tab")
  await expect(page.locator("[data-restart]")).toBeFocused()
  const outline = await page
    .locator("[data-restart]")
    .evaluate((node) => getComputedStyle(node).outlineStyle)
  assert.equal(outline, "solid")
  await page.addScriptTag({ url: base + "/__axe.js" })
  const axe = await page.evaluate(async () =>
    (
      await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
      })
    ).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) }))
  )
  assert.deepEqual(axe, [])
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(page.locator("[data-toggle]")).toBeEnabled()
  await page.locator("[data-restart]").click()
  await system.scrollIntoViewIfNeeded()
  await page.setViewportSize({ width: 1440, height: 1100 })
  await system.scrollIntoViewIfNeeded()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )
  await page.clock.install()
  await page.locator("[data-toggle]").click()
  await page.clock.runFor(50)
  await expect(system).toHaveAttribute("data-playing", "true")
  await page.clock.runFor(2300)
  await expect(page.locator("[data-step]")).toHaveText("Step 2 / 12")
  await page.locator("[data-toggle]").click()
  await page.clock.runFor(10000)
  await expect(page.locator("[data-step]")).toHaveText("Step 2 / 12")
  await page.locator("[data-toggle]").click()
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(system).toHaveAttribute("data-playing", "false")
  await page.clock.runFor(10000)
  await expect(page.locator("[data-step]")).toHaveText("Step 2 / 12")
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.clock.runFor(2300)
  await expect(page.locator("[data-step]")).toHaveText("Step 3 / 12")
  // Offscreen playback pauses; resume only when visible.
  await page.locator("footer").scrollIntoViewIfNeeded()
  await expect(system).toHaveAttribute("data-playing", "false")
  const offscreenStep = await page.locator("[data-step]").textContent()
  await page.clock.runFor(10000)
  assert.equal(await page.locator("[data-step]").textContent(), offscreenStep)
  await system.scrollIntoViewIfNeeded()
  await page.clock.runFor(50)
  await expect(system).toHaveAttribute("data-playing", "true")
  // Removing the element cancels its scheduled work; reconnect remains functional.
  await page.evaluate(() => {
    window.detachedSystem = document.querySelector("ej-job-system")
    window.detachedStep = window.detachedSystem.querySelector("[data-step]").textContent
    window.detachedSystem.remove()
  })
  await page.clock.runFor(10000)
  assert(
    await page.evaluate(
      () =>
        window.detachedSystem.querySelector("[data-step]").textContent ===
        window.detachedStep
    )
  )
  await page.evaluate(() => document.querySelector(".hero").append(window.detachedSystem))
  await expect(page.locator("[data-step]")).toHaveText("Step 1 / 12")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator("[data-toggle]")).toBeDisabled()
  await expect(system).toHaveAttribute("data-playing", "false")
  await page.clock.runFor(10000)
  await expect(page.locator("[data-step]")).toHaveText("Step 1 / 12")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(page.locator("[data-toggle]")).toBeEnabled()
  await system.scrollIntoViewIfNeeded()
  await page.locator("[data-toggle]").click()
  await page.clock.runFor(50)
  await expect(system).toHaveAttribute("data-playing", "true")
  await page.clock.runFor(30000)
  await expect(page.locator("[data-step]")).toHaveText("Step 12 / 12")
  await expect(system).toHaveAttribute("data-playing", "false")
  await expect(page.locator("[data-toggle]")).toBeDisabled()
  await expect(page.locator(".job")).toHaveCount(4)
  // A separate no-JS navigation sees real text and source, with inert controls hidden.
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 900 }
  })
  const staticPage = await noJs.newPage()
  await staticPage.goto(base)
  await expect(staticPage.locator("h1")).toContainText("The work goes on.")
  await expect(staticPage.locator(".no-script")).toContainText("RetryScheduled")
  await expect(staticPage.locator("[data-code]")).toContainText("GenerateReport.enqueue")
  await expect(staticPage.locator(".playback")).toBeHidden()
  await expect(staticPage.locator('a[href="/docs/start/first-job"]')).toBeVisible()
  await staticPage.screenshot({ path: resolve(evidence, "no-js.png"), fullPage: true })
  await noJs.close()
  assert.deepEqual(errors, [])
  console.log(
    `PASS Chromium ${browser.version()}: 12-step lifecycle, four-job selection/source sync, capacity=2, retry attempt, finite playback, pause/restart, keyboard/focus, 1440/768/390/320 widths, 200%-equivalent layout, reduced-motion, hidden/offscreen/removal cleanup, no-JS, axe WCAG AA.`
  )
} finally {
  await browser?.close()
  await new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
