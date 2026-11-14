import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, extname } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(resolve("apps/website/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve("apps/website/dist/site")
const evidence = resolve(".multica/walkthrough-final/controls-refinement/controls")
await mkdir(evidence, { recursive: true })
const policy = (await readFile(resolve(output, "_headers"), "utf8")).match(
  /Content-Security-Policy: (.*)/
)[1]
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname
    const file = resolve(output, "." + (path === "/" ? "/index.html" : path))
    assert(file.startsWith(output + "/"))
    response.setHeader("Content-Security-Policy", policy)
    response.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml"
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
  port,
  checks: [],
  screenshots: [],
  videos: [],
  errors: [],
  violations: []
}
let browser
const rowGeometry = (node) => {
  const row = node.getBoundingClientRect()
  const flow = node.closest(".worker-flow").getBoundingClientRect()
  return { x: row.x - flow.x, y: row.y - flow.y, width: row.width }
}
const same = (left, right) => {
  for (const key of Object.keys(left)) {
    assert(Math.abs(left[key] - right[key]) < 0.5, JSON.stringify({ left, right }))
  }
}
try {
  browser = await chromium.launch({ headless: true })
  result.chromium = browser.version()
  const origin = `http://127.0.0.1:${port}`
  const prepare = async (context) => {
    await context.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) =>
        window.cspViolations.push(event.effectiveDirective)
      )
    })
    const page = await context.newPage()
    page.on("pageerror", (error) => result.errors.push(error.message))
    await page.goto(origin)
    await expect(page.locator(".stage-button")).toHaveCount(9)
    return page
  }
  const shot = async (page, width, label, locator) => {
    const file = `${width}-${label}.png`
    if (locator) {
      await locator.screenshot({ path: resolve(evidence, file) })
    } else {
      await page.screenshot({ path: resolve(evidence, file), fullPage: true })
    }
    result.screenshots.push(file)
  }
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      colorScheme: "light"
    })
    const page = await prepare(context)
    const main = page.locator("main")
    const tx = page.locator("#transaction")
    const worker = page.locator("#handler")
    const txStage = (phase) => tx.locator(`.stage-button[data-stage="${phase}"]`)
    const workStage = (phase) => worker.locator(`.stage-button[data-stage="${phase}"]`)
    const remaining = (scene) =>
      scene.evaluate((node) => Number(node.dataset.remainingMs))
    const ratio = (scene) =>
      scene
        .locator(".stage-button[aria-current] .stage-progress")
        .evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)
    const assertCleanCode = async () => {
      assert(
        await page
          .locator(".code-panel .line")
          .evaluateAll((nodes) =>
            nodes.every(
              (node) =>
                getComputedStyle(node).boxShadow === "none" &&
                getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)"
            )
          )
      )
    }
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(page.locator(".playback:visible")).toHaveCount(0)
    assert(
      await page
        .locator(".code-panel .line")
        .evaluateAll((nodes) =>
          nodes.every((node) => getComputedStyle(node).opacity === "1")
        )
    )
    await assertCleanCode()
    await expect(page.locator("#shared .file-label")).toHaveText("shared/jobs/orders.ts")
    await expect(page.locator("#shared pre")).toContainText("ConfirmationJobGroup")
    await expect(page.locator("#shared pre")).toContainText("OrdersJobApi")
    await expect(
      page.locator("#shared .stage-button, #shared [data-code-seek]")
    ).toHaveCount(0)
    await shot(page, width, "full")
    await page.clock.install()
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)))
    await page.evaluate(() => {
      window.pendingClockFrames = new Set()
      const request = window.requestAnimationFrame.bind(window)
      const cancel = window.cancelAnimationFrame.bind(window)
      window.requestAnimationFrame = (callback) => {
        const id = request((now) => {
          window.pendingClockFrames.delete(id)
          callback(now)
        })
        window.pendingClockFrames.add(id)
        return id
      }
      window.cancelAnimationFrame = (id) => {
        window.pendingClockFrames.delete(id)
        cancel(id)
      }
    })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await txStage(2).click()
    await expect(tx).toHaveAttribute("data-phase", "2")
    await expect(txStage(2)).toHaveAttribute("aria-current", "step")
    await expect(tx.locator(".transaction-playback")).toHaveAttribute(
      "aria-label",
      "Play commit animation"
    )
    assert.equal(await remaining(tx), 2200)
    assert.equal(await ratio(tx), 1)
    await page.clock.runFor(5000)
    await expect(tx).toHaveAttribute("data-phase", "2")
    await expect(workStage(3)).toBeDisabled()
    await expect(
      worker.locator(".stage-track:visible, .stage-button[aria-current]")
    ).toHaveCount(0)
    await expect(worker.locator('[aria-live="polite"]')).toHaveText(
      "Waiting for a committed job"
    )
    await expect(worker.locator(".received-job")).toBeHidden()
    const insert = tx.getByRole("button", { name: "Inspect: Insert order", exact: true })
    await insert.focus()
    await page.keyboard.press("Enter")
    await expect(insert).toBeFocused()
    await expect(tx).toHaveAttribute("data-phase", "1")
    await expect(tx.locator(".stage-order:visible")).toHaveCount(1)
    await expect(tx.locator(".stage-job:visible")).toHaveCount(0)
    const emphasis = await tx.locator(".commit-code .line").evaluateAll((nodes) =>
      nodes.map((node) => ({
        opacity: Number(getComputedStyle(node).opacity),
        active: node.dataset.active === "true",
        colors: [...node.querySelectorAll("span[style]")].map(
          (token) => getComputedStyle(token).color
        )
      }))
    )
    assert.equal(emphasis[3].opacity, 1)
    assert(emphasis[2].opacity < 1 && emphasis[2].opacity >= 0.6)
    assert(new Set(emphasis.flatMap((line) => line.colors)).size >= 4)
    await assertCleanCode()
    await shot(page, width, "source-focus", tx)
    // Selecting/copying text must not seek when the resulting click bubbles.
    const selectedText = await tx
      .locator('.commit-code [data-code-seek="2"]')
      .first()
      .evaluate((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        const selection = getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        return selection.toString()
      })
    assert(selectedText.includes("PlaceOrder.enqueue"))
    await expect(tx).toHaveAttribute("data-phase", "1")
    await page.evaluate(() => getSelection().removeAllRanges())
    await tx.locator(".transaction-playback").click()
    await page.clock.runFor(700)
    const partial = await remaining(tx)
    assert(partial > 1430 && partial < 1570, String(partial))
    assert(Math.abs((await ratio(tx)) - partial / 2200) < 0.005)
    await tx.locator(".transaction-playback").click()
    const paused = await remaining(tx)
    await page.clock.runFor(4000)
    assert.equal(await remaining(tx), paused)
    await shot(page, width, "countdown-paused", tx)
    await tx.locator(".transaction-playback").click()
    await page.clock.runFor(paused - 70)
    await expect(tx).toHaveAttribute("data-phase", "1")
    await page.clock.runFor(110)
    await expect(tx).toHaveAttribute("data-phase", "2")
    assert((await ratio(tx)) > 0.95)
    await txStage(3).click()
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(worker).toHaveAttribute("data-phase", "0")
    await page.clock.runFor(5000)
    await expect(worker).toHaveAttribute("data-phase", "0")
    await workStage(1).click()
    await expect(worker).toHaveAttribute("data-phase", "1")
    assert.equal(await remaining(worker), 1800)
    assert.equal(await ratio(worker), 1)
    await expect(worker.locator(".travel-row")).toHaveText("job-7f2order-041")
    await worker.locator(".worker-playback").click()
    await page.clock.runFor(600)
    const moving = await worker.locator(".travel-row").evaluate(rowGeometry)
    const elapsed = await worker.evaluate((node) => Number(node.dataset.elapsedMs))
    const animationTime = await worker
      .locator(".travel-row")
      .evaluate((node) => node.getAnimations()[0].currentTime)
    assert(Math.abs(animationTime - elapsed) < 1)
    await worker.locator(".worker-playback").click()
    const frozen = await worker.locator(".travel-row").evaluate(rowGeometry)
    const frozenRemaining = await remaining(worker)
    const frozenRatio = await ratio(worker)
    await page.clock.runFor(3000)
    same(frozen, await worker.locator(".travel-row").evaluate(rowGeometry))
    assert.equal(await remaining(worker), frozenRemaining)
    assert.equal(await ratio(worker), frozenRatio)
    await shot(page, width, "row-and-countdown-paused", worker)
    if (width === 1440) {
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.clock.runFor(64)
      const resized = await worker.locator(".travel-row").evaluate(rowGeometry)
      await page.clock.runFor(600)
      same(resized, await worker.locator(".travel-row").evaluate(rowGeometry))
      assert.equal(await remaining(worker), frozenRemaining)
      await shot(page, width, "paused-mobile-reflow", worker)
      await page.setViewportSize({ width, height: 1000 })
      await page.clock.runFor(64)
    }
    await worker.locator(".worker-playback").click()
    await page.clock.runFor(100)
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect(worker).toHaveAttribute("data-playing", "false")
    const hiddenRemaining = await remaining(worker)
    const hiddenGeometry = await worker.locator(".travel-row").evaluate(rowGeometry)
    await page.clock.runFor(4000)
    assert.equal(await remaining(worker), hiddenRemaining)
    same(hiddenGeometry, await worker.locator(".travel-row").evaluate(rowGeometry))
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.clock.runFor(hiddenRemaining - 70)
    await expect(worker).toHaveAttribute("data-phase", "1")
    await page.clock.runFor(110)
    await expect(worker).toHaveAttribute("data-phase", "2")
    await expect(worker.locator(".received-job")).toHaveText("job-7f2order-041")
    await expect(worker.locator(".stored-job")).toBeVisible()
    assert((await ratio(worker)) > 0.95)
    await workStage(3).click()
    await page.clock.runFor(4000)
    await expect(worker).toHaveAttribute("data-phase", "3")
    assert.notEqual(
      await worker
        .locator(".adapter-box")
        .evaluate((node) => getComputedStyle(node).borderTopColor),
      "rgb(181, 164, 209)"
    )
    const send = worker.getByRole("button", { name: "Inspect: Call email adapter" })
    await send.focus()
    await page.keyboard.press("Space")
    await expect(send).toBeFocused()
    await expect(worker).toHaveAttribute("data-phase", "4")
    await expect(worker.locator(".stage-track:visible")).toHaveCount(0)
    await shot(page, width, "adapter-code-seek", worker)
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("#handler .stage-button")]
      for (let index = 0; index < 100; index++) {
        buttons[index % 5].click()
      }
      buttons[1].click()
    })
    await expect(worker).toHaveAttribute("data-phase", "1")
    await page.clock.runFor(5000)
    await expect(worker).toHaveAttribute("data-phase", "1")
    assert.equal(await remaining(worker), 1800)
    assert.equal(
      await worker.locator(".travel-row").evaluate((node) => node.getAnimations().length),
      1
    )
    assert.equal(await page.locator(".worker-playback").count(), 1)
    await txStage(0).click()
    await expect(main).toHaveAttribute("data-result", "pending")
    await expect(worker.locator(".received-job")).toBeHidden()
    assert.equal(
      await worker.locator(".travel-row").evaluate((node) => node.getAnimations().length),
      0
    )
    await worker
      .getByRole("button", {
        name: "Inspect: Run confirmation handler",
        includeHidden: true
      })
      .dispatchEvent("click")
    await expect(worker).toHaveAttribute("data-phase", "0")
    await page.getByRole("radio", { name: "Rollback", exact: true }).check()
    await page.clock.runFor(7000)
    await expect(main).toHaveAttribute("data-result", "rolled-back")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
    await expect(workStage(4)).toBeDisabled()
    await expect(txStage(3)).toHaveText("Rollback")
    await tx.getByRole("button", { name: "Inspect: Rollback after rejection" }).focus()
    await page.keyboard.press("Enter")
    await expect(main).toHaveAttribute("data-result", "rolled-back")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.getByRole("radio", { name: "Commit", exact: true }).check()
    await txStage(1).click()
    await page.clock.runFor(5000)
    await expect(tx).toHaveAttribute("data-phase", "1")
    await expect(tx.locator(".stage-track:visible")).toHaveCount(0)
    await expect(page.locator(".playback:visible")).toHaveCount(0)
    await txStage(3).click()
    await workStage(3).click()
    await expect(worker.locator(".received-job")).toBeVisible()
    await workStage(1).click()
    await page.clock.runFor(5000)
    await expect(worker).toHaveAttribute("data-phase", "1")
    assert.equal(await remaining(worker), 1800)
    await shot(page, width, "reduced-manual", worker)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert(
      await page
        .locator(".stage-strip, pre")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)
        )
    )
    await tx
      .locator("astro-island")
      .evaluate((node) => node.dispatchEvent(new Event("astro:unmount")))
    await expect(page.locator(".stage-button, [data-code-seek]")).toHaveCount(0)
    assert.equal(await page.evaluate(() => window.pendingClockFrames.size), 0)
    assert.equal(
      await worker.locator(".travel-row").evaluate((node) => node.getAnimations().length),
      0
    )
    await expect(main).toHaveAttribute("data-result", "saved")
    result.violations.push(...(await page.evaluate(() => window.cspViolations)))
    result.checks.push({
      width,
      partial,
      paused,
      moving,
      frozen,
      frozenRemaining,
      hiddenRemaining,
      emphasis,
      deterministicSeeking: true,
      remainingTimeResume: true,
      sharedClockGeometry: true,
      rapidSeeksGated: true,
      reducedManual: true,
      keyboardFocusAndSelection: true,
      cleanup: true
    })
    await context.close()
  }
  // Short, real-time recordings: actual draining progress and source/stage seeking.
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      recordVideo: { dir: resolve(evidence, "video"), size: { width, height: 1000 } }
    })
    const page = await prepare(context)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const tx = page.locator("#transaction")
    await tx.locator('.stage-button[data-stage="2"]').click()
    await tx.locator(".transaction-playback").click()
    await page.waitForTimeout(850)
    await shot(page, width, "real-countdown-draining", tx)
    await tx.locator(".transaction-playback").click()
    await page.waitForTimeout(400)
    await tx.locator('.stage-button[data-stage="3"]').click()
    const worker = page.locator("#handler")
    await worker.locator('.stage-button[data-stage="1"]').click()
    await worker.locator(".worker-playback").click()
    await page.waitForTimeout(650)
    await worker.locator(".worker-playback").click()
    await shot(page, width, "real-row-progress-paused", worker)
    const handler = worker.getByRole("button", {
      name: "Inspect: Run confirmation handler"
    })
    await handler.focus()
    await page.keyboard.press("Enter")
    await shot(page, width, "real-source-focused", worker)
    const video = page.video()
    result.violations.push(...(await page.evaluate(() => window.cspViolations)))
    await context.close()
    result.videos.push({ width, path: await video.path() })
  }
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 1000 }
    })
    const page = await context.newPage()
    await page.goto(origin)
    await expect(
      page.locator(".stage-button, [data-code-seek], .playback:visible")
    ).toHaveCount(0)
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(2)
    assert(
      await page
        .locator(".code-panel .line")
        .evaluateAll((nodes) =>
          nodes.every((node) => getComputedStyle(node).opacity === "1")
        )
    )
    await context.close()
  }
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.violations, [])
  result.status = "PASS"
} catch (error) {
  result.status = "FAILED"
  result.error = String(error.stack ?? error)
  throw error
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  result.serverStopped = !server.listening
  await writeFile(
    resolve(evidence, "controls.json"),
    JSON.stringify(result, null, 2) + "\n"
  )
}
console.log(
  "PASS: stage/code seeking, shared real clock/countdown/geometry, remaining-time pause/resume, causality/gating, rapid seeks, keyboard/selectable syntax, 1440/390/320, reduced-motion/noJS, emitted CSP and cleanup."
)
