// Browser/HTTP/filesystem automation is a test-owned foreign-function boundary.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve, extname } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(resolve("apps/website/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve("apps/website/dist/site")
const evidence = resolve(
  process.env.LANDING_EVIDENCE_DIRECTORY ?? ".multica/walkthrough-final"
)
await mkdir(evidence, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
    const file = resolve(output, "." + (path === "/" ? "/index.html" : path))
    assert(file.startsWith(output + "/"))
    response.setHeader(
      "content-type",
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
let browser
const screenshots = []
const videos = []
const checks = []
const errors = []
const geometry = (node) => {
  const row = node.getBoundingClientRect()
  const flow = node.closest(".worker-flow").getBoundingClientRect()
  return { x: row.x - flow.x, y: row.y - flow.y, width: row.width, height: row.height }
}
const sameGeometry = (left, right) => {
  for (const key of ["x", "y", "width", "height"]) {
    assert(Math.abs(left[key] - right[key]) < 0.5, JSON.stringify({ left, right }))
  }
}
let result
try {
  browser = await chromium.launch({ headless: true })
  const base = `http://127.0.0.1:${port}`
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      colorScheme: "light",
      reducedMotion: "reduce",
      recordVideo: { dir: resolve(evidence, "video"), size: { width, height: 1000 } }
    })
    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(base)
    await expect(page.getByRole("radio", { name: "Commit", exact: true })).toBeChecked()
    const tx = page.locator("#transaction")
    const worker = page.locator("#handler")
    const main = page.locator("main")
    const shot = async (name, locator) => {
      const path = `${width}-${name}.png`
      if (locator) {
        await locator.screenshot({ path: resolve(evidence, path) })
      } else {
        await page.screenshot({ path: resolve(evidence, path), fullPage: true })
      }
      screenshots.push(path)
    }
    await page.keyboard.press("Tab")
    await expect(page.locator(".skip")).toBeFocused()
    await page.keyboard.press("Enter")
    await page.locator("h1").click()
    await page.evaluate(() => scrollTo(0, 0))
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(tx.locator(".commit-path")).toBeVisible()
    await expect(tx.locator(".rollback-path")).toBeHidden()
    await expect(page.locator(".playback:visible")).toHaveCount(0)
    await shot("full")
    await page.screenshot({ path: resolve(evidence, `${width}-hero.png`) })
    screenshots.push(`${width}-hero.png`)
    await shot("tables", page.locator("#rows"))
    await shot("shared", page.locator("#shared"))
    // Reduced motion keeps the selector useful, but switches directly to truthful results.
    await page.getByRole("radio", { name: "Rollback", exact: true }).check()
    await expect(main).toHaveAttribute("data-result", "rolled-back")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
    await expect(worker.locator(".received-job")).toBeHidden()
    await shot("reduced-rollback", tx)
    await page.getByRole("radio", { name: "Commit", exact: true }).check()
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(page.locator("#shared pre")).toBeVisible()
    for (const symbol of [
      "JobProducer.make",
      "JobProducer.withSlot",
      "JobQueue.make",
      "JobGroup.make",
      "JobApi.make"
    ]) {
      await expect(page.locator("#shared pre")).toContainText(symbol)
    }
    const overflow = async () => {
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      assert(
        await page
          .locator("pre, table, .job-row")
          .evaluateAll((nodes) =>
            nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)
          )
      )
    }
    await overflow()
    assert.equal(
      await page
        .locator("body")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      "rgb(23, 23, 25)"
    )
    assert(
      await page
        .locator(
          ".code-panel, .transaction-compare, .database, .worker-box, .adapter-box"
        )
        .evaluateAll((nodes) =>
          nodes.every((node) => {
            const rgb = getComputedStyle(node).backgroundColor.match(/\d+/g)
            return rgb && rgb.slice(0, 3).every((value) => Number(value) < 65)
          })
        )
    )
    assert(
      await page
        .locator("pre")
        .evaluateAll((nodes) =>
          nodes.every((node) => parseFloat(getComputedStyle(node).fontSize) >= 14)
        )
    )
    const tables = await page.locator("#rows table").evaluateAll((nodes) =>
      nodes.map((table) => {
        const headers = [...table.querySelectorAll("thead th")].map((cell) =>
          cell.getBoundingClientRect()
        )
        const cells = [...table.querySelectorAll("tbody td")].map((cell) =>
          cell.getBoundingClientRect()
        )
        return {
          columns: cells.length,
          horizontal: cells.every((cell) => Math.abs(cell.top - cells[0].top) < 1),
          below: cells[0].top >= headers[0].bottom - 1
        }
      })
    )
    assert(
      tables.every((table) => table.columns === 3 && table.horizontal && table.below)
    )

    await tx.scrollIntoViewIfNeeded()
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await tx.locator(".transaction-playback").click()
    const transaction = []
    for (let phase = 0; phase <= 3; phase++) {
      await expect(tx).toHaveAttribute("data-phase", String(phase), { timeout: 5000 })
      await expect(tx.locator(".branch:visible")).toHaveCount(1)
      await expect(tx.locator(".rollback-path")).toBeHidden()
      const counts = {
        phase,
        order: await tx.locator(".stage-order:visible").count(),
        job: await tx.locator(".stage-job:visible").count(),
        empty: await tx.locator(".empty-tx:visible").count()
      }
      assert.deepEqual(counts, {
        phase,
        order: phase > 0 ? 1 : 0,
        job: phase >= 2 ? 1 : 0,
        empty: phase === 0 ? 1 : 0
      })
      if (phase < 3) {
        await expect(main).toHaveAttribute("data-result", "pending")
        await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
        await expect(worker.locator(".stored-job")).toBeHidden()
        await expect(worker.locator(".received-job")).toBeHidden()
        await expect(worker.locator(".worker-playback")).toBeHidden()
        await expect(worker).toHaveAttribute("data-phase", "0")
      }
      const highlights = await tx
        .locator(".commit-code .line")
        .evaluateAll((nodes) =>
          nodes.flatMap((node, index) =>
            node.dataset.active === "true" ? [index + 1] : []
          )
        )
      assert.deepEqual(highlights, [[2], [4], [6, 7, 8, 9, 10], [11, 12]][phase])
      transaction.push(counts)
      await shot(`commit-${phase}`, tx)
      if (phase < 3) {
        await expect(tx).toHaveAttribute("data-phase", String(phase + 1), {
          timeout: 5000
        })
      }
    }
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(2)
    // Reset only the worker via a motion preference change; capture real-time phases.
    await worker.locator(".worker-outcome").scrollIntoViewIfNeeded()
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await expect(worker).toHaveAttribute("data-phase", "0")
    const border = async (selector) =>
      worker.locator(selector).evaluate((node) => getComputedStyle(node).borderTopColor)
    assert.equal(await border(".worker-box"), "rgb(181, 164, 209)")
    assert.notEqual(await border(".flow-database"), "rgb(181, 164, 209)")
    assert.notEqual(await border(".adapter-box"), "rgb(181, 164, 209)")
    await expect(worker.locator(".received-job")).toBeHidden()
    await shot("worker-start", worker)
    await expect(worker).toHaveAttribute("data-phase", "1", { timeout: 5000 })
    await page.waitForTimeout(450)
    const movingBefore = await worker.locator(".travel-row").evaluate(geometry)
    await expect(worker.locator(".travel-row")).toContainText("job-7f2")
    await expect(worker.locator(".travel-row")).toContainText("order-041")
    await worker.locator(".worker-playback").click()
    await expect(worker.locator(".worker-playback")).toHaveAttribute(
      "data-playing",
      "false"
    )
    const frozen = await worker.locator(".travel-row").evaluate(geometry)
    await page.waitForTimeout(700)
    sameGeometry(frozen, await worker.locator(".travel-row").evaluate(geometry))
    const source = await worker.locator(".stored-job").evaluate(geometry)
    const target = await worker.locator(".received-job").evaluate(geometry)
    assert(frozen.y > source.y && frozen.y < target.y)
    await shot("row-mid-flight-paused", worker)
    await expect(worker.locator(".stored-job")).toBeVisible()
    await expect(worker.locator(".storage-state")).toHaveText("Claimed · still stored", {
      useInnerText: true
    })
    await worker.locator(".worker-playback").click()
    await expect(worker).toHaveAttribute("data-phase", "2", { timeout: 5000 })
    await expect(worker.locator(".received-job")).toHaveText("job-7f2order-041")
    await expect(worker.locator(".received-job")).toBeVisible()
    await expect(worker.locator(".stored-job")).toBeVisible()
    assert.notEqual(await border(".adapter-box"), "rgb(181, 164, 209)")
    await shot("row-received", worker)
    await expect(worker).toHaveAttribute("data-phase", "3", { timeout: 5000 })
    await expect(worker.locator(".handler-state")).toHaveText("Confirming order-041", {
      useInnerText: true
    })
    assert.equal(await border(".handler-operation"), "rgb(181, 164, 209)")
    assert.notEqual(await border(".adapter-box"), "rgb(181, 164, 209)")
    await shot("handler-running", worker)
    await expect(worker).toHaveAttribute("data-phase", "4", { timeout: 5000 })
    assert.equal(await border(".adapter-box"), "rgb(181, 164, 209)")
    await shot("adapter-called", worker)
    await page.waitForTimeout(2400)
    await expect(worker).toHaveAttribute("data-phase", "4")

    // Native radio keys switch the only path and reset every downstream result.
    const commitRadio = page.getByRole("radio", { name: "Commit", exact: true })
    await commitRadio.focus()
    await page.keyboard.press("ArrowRight")
    await expect(page.getByRole("radio", { name: "Rollback", exact: true })).toBeChecked()
    await expect(main).toHaveAttribute("data-outcome", "rollback")
    await expect(tx).toHaveAttribute("data-phase", "0")
    for (let phase = 0; phase <= 3; phase++) {
      await expect(tx).toHaveAttribute("data-phase", String(phase), { timeout: 5000 })
      await expect(tx.locator(".commit-path")).toBeHidden()
      await expect(tx.locator(".branch:visible")).toHaveCount(1)
      await expect(tx.locator(".rollback-code")).toBeVisible()
      await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
      await expect(worker.locator(".received-job")).toBeHidden()
      const highlights = await tx
        .locator(".rollback-code .line")
        .evaluateAll((nodes) =>
          nodes.flatMap((node, index) =>
            node.dataset.active === "true" ? [index + 1] : []
          )
        )
      assert.deepEqual(highlights, [[2], [4], [5, 6, 7, 8, 9], [10, 11, 12]][phase])
      await shot(`rollback-${phase}`, tx)
      if (phase < 3) {
        await expect(tx).toHaveAttribute("data-phase", String(phase + 1), {
          timeout: 5000
        })
      }
    }
    await expect(main).toHaveAttribute("data-result", "rolled-back")
    await expect(tx.locator(".rollback-path .row-chip:visible")).toHaveCount(0)
    await expect(tx.locator(".transaction-status")).toHaveText(
      "Rollback confirmed. Neither row was saved. No job to process.",
      { useInnerText: true }
    )
    await shot("rollback-tables", page.locator("#rows"))
    await shot("rollback-worker", worker)
    await page.addScriptTag({
      content: await readFile(require.resolve("axe-core/axe.min.js"), "utf8")
    })
    const selectorAxe = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map((finding) => finding.id)
    )
    assert.deepEqual(selectorAxe, [])
    await page.waitForTimeout(2400)
    await expect(worker).toHaveAttribute("data-phase", "0")
    await expect(worker.locator(".worker-playback")).toBeHidden()
    // Replay preserves the selected rollback. Keyboard pause holds BEGIN.
    await tx.locator(".transaction-playback").focus()
    await page.keyboard.press("Enter")
    await expect(tx).toHaveAttribute("data-phase", "0")
    await expect(main).toHaveAttribute("data-outcome", "rollback")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(2400)
    await expect(tx).toHaveAttribute("data-phase", "0")
    assert.equal(
      await tx
        .locator(".transaction-playback")
        .evaluate((node) => getComputedStyle(node).outlineStyle),
      "solid"
    )
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
    await commitRadio.focus()
    await page.keyboard.press("Space")
    await expect(main).toHaveAttribute("data-outcome", "commit")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(main).toHaveAttribute("data-result", "saved")

    // Mid-flight lifetime checks: document hidden, offscreen, detached, unmount.
    await worker.locator(".worker-outcome").scrollIntoViewIfNeeded()
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await expect(worker).toHaveAttribute("data-phase", "1", { timeout: 5000 })
    await page.waitForTimeout(250)
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect(worker).toHaveAttribute("data-playing", "false")
    const hidden = await worker.locator(".travel-row").evaluate(geometry)
    await page.waitForTimeout(450)
    sameGeometry(hidden, await worker.locator(".travel-row").evaluate(geometry))
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }))
    await expect(worker).toHaveAttribute("data-playing", "false")
    await expect(worker).toHaveAttribute("data-phase", "1")
    const offscreen = await worker.locator(".travel-row").evaluate(geometry)
    await page.waitForTimeout(450)
    sameGeometry(offscreen, await worker.locator(".travel-row").evaluate(geometry))
    await page.evaluate(() => {
      window.detachedWorker = document.querySelector("#handler")
      window.detachedWorker.remove()
    })
    await page.waitForTimeout(450)
    assert.equal(await page.evaluate(() => window.detachedWorker.dataset.phase), "1")
    await page.evaluate(() =>
      document.querySelector("#shared").before(window.detachedWorker)
    )
    // Replaying the transaction cancels even an in-flight copy, not just its timer.
    await tx.locator(".transaction-playback").click()
    await expect(tx).toHaveAttribute("data-phase", "0")
    await expect(main).toHaveAttribute("data-result", "pending")
    await expect(worker).toHaveAttribute("data-phase", "0")
    await expect(worker.locator(".received-job")).toBeHidden()
    assert.equal(
      await worker.locator(".travel-row").evaluate((node) => node.getAnimations().length),
      0
    )
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(0)
    await page.getByRole("radio", { name: "Rollback", exact: true }).check()
    await expect(main).toHaveAttribute("data-outcome", "rollback")
    await expect(worker.locator(".worker-playback")).toBeHidden()
    await tx
      .locator("astro-island")
      .evaluate((node) => node.dispatchEvent(new Event("astro:unmount")))
    await expect(page.locator(".playback")).toHaveCount(0)
    await expect(main).toHaveAttribute("data-result", "saved")
    await expect(worker).toHaveAttribute("data-phase", "4")
    assert.equal(
      await worker.locator(".travel-row").evaluate((node) => node.getAnimations().length),
      0
    )
    // Resetting the static source emphasis may finish its existing 1s color fade.
    await page.waitForTimeout(1200)
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length
      ),
      0
    )
    await overflow()
    await page.addScriptTag({
      content: await readFile(require.resolve("axe-core/axe.min.js"), "utf8")
    })
    const axe = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
      ).violations.map((finding) => ({
        id: finding.id,
        targets: finding.nodes.map((node) => node.target)
      }))
    )
    assert.deepEqual(axe, [])
    checks.push({
      width,
      transaction,
      tables,
      movingBefore,
      frozen,
      source,
      target,
      onlyWorkerInitial: true,
      fullRowMotion: true,
      pauseFreezesGeometry: true,
      causalHandlerAdapter: true,
      rollbackNoRowsOrWork: true,
      selectedReplay: true,
      keyboardSelector: true,
      reducedMotion: true,
      noOverflow: true,
      hiddenOffscreenDetachedUnmount: true,
      finite: true,
      axe: "PASS"
    })
    const video = page.video()
    await context.close()
    videos.push({ width, path: await video.path() })
  }
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 1000 },
      colorScheme: "light"
    })
    const page = await context.newPage()
    await page.goto(base)
    await expect(page.locator("#transaction .commit-path")).toBeVisible()
    await expect(page.locator("#transaction .rollback-path")).toBeHidden()
    await expect(page.locator("#rows tbody tr:visible")).toHaveCount(2)
    await expect(
      page.locator(".outcome-selector:visible, .playback:visible")
    ).toHaveCount(0)
    await expect(page.locator("#handler .received-job")).toBeVisible()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({
      path: resolve(evidence, `${width}-no-js.png`),
      fullPage: true
    })
    screenshots.push(`${width}-no-js.png`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  result = {
    status: "PASS",
    chromium: browser.version(),
    port,
    checks,
    screenshots,
    videos,
    noJS: [1440, 768, 390],
    errors
  }
} catch (error) {
  await writeFile(resolve(evidence, "browser-error.txt"), String(error.stack ?? error))
  throw error
} finally {
  await browser?.close()
  await new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
await writeFile(
  resolve(evidence, "browser.json"),
  JSON.stringify({ ...result, serverStoppedOnExit: !server.listening }, null, 2)
)
console.log(
  "PASS: default commit and single-path selector, selected rollback replay/no downstream rows or work, full-row motion with both IDs, geometry-frozen pause/lifetimes, causal worker/handler/adapter, 1440/390 real-time screenshots/video, 768 reflow, noJS/reduced-motion/keyboard/axe/cleanup."
)
