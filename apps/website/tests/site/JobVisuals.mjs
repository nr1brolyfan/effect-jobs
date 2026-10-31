import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const require = createRequire(join(root, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const origin = process.env.DOCS_CORRECTIONS_URL
assert(origin, "Provide the actual local preview origin")
const output = process.env.JOB_VISUAL_EVIDENCE ?? join(root, ".toolchain/job-visuals")
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const receipt = { screenshots: [], checks: [], pageErrors: [], mutations: [] }
const label = (figure, name) => figure.locator(`[data-label="${name}"]`)
const step = (figure) => figure.locator("[data-action=step]").click()
const reset = (figure) => figure.locator("[data-action=reset]").click()

try {
  for (const width of [1920, 1440, 1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    page.on("pageerror", (error) => receipt.pageErrors.push(error.message))
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        receipt.mutations.push(request.url())
    })
    await page.goto(origin + "/docs/start/tutorial/")
    await page.evaluate(() => document.fonts.ready)
    const overview = page.locator('[data-job-visual="overview"]')
    const transaction = page.locator('[data-job-visual="transaction"]')
    const handoff = page.locator('[data-job-visual="handoff"]')
    await expect(overview.locator(".jv-controls")).toBeVisible()
    const position = await overview.evaluate((element) => {
      let next = element.nextElementSibling
      while (next?.matches("script, style")) next = next.nextElementSibling
      return {
        before: element.previousElementSibling.textContent,
        after: next.textContent
      }
    })
    assert(position.before.includes("For local runs"))
    assert(position.after.includes("1. Place an order without waiting for email"))

    await expect(label(overview, "order")).toHaveText("—")
    await expect(label(overview, "jobState")).toHaveText("—")
    // Both durable records appear at one commit, before the response or external call.
    await step(overview)
    await expect(label(overview, "order")).toHaveText("#041")
    await expect(label(overview, "jobState")).toHaveText("Pending")
    await expect(label(overview, "response")).not.toHaveText("201 Created")
    await expect(label(overview, "emailState")).toHaveText("—")
    await step(overview)
    await expect(label(overview, "response")).toHaveText("201 Created")
    await expect(label(overview, "jobState")).toHaveText("Pending")
    await step(overview)
    await expect(label(overview, "jobState")).toHaveText("Active")
    await step(overview)
    await expect(label(overview, "emailState")).toHaveText("Sent")
    await step(overview)
    await expect(label(overview, "jobState")).toHaveText("Completed")
    await expect(overview.locator('[data-node="job"]')).toHaveCount(1)
    await expect(overview.locator("[data-action=step]")).toBeDisabled()

    // Uncommitted writes cannot become a worker claim; rollback is not Unknown.
    await step(transaction)
    await expect(label(transaction, "orderState")).toHaveText("")
    await expect(label(transaction, "job")).toHaveText("—")
    await step(transaction)
    await expect(label(transaction, "decision")).toHaveText("Uncommitted")
    await expect(label(transaction, "workerState")).toHaveText("Waiting")
    await step(transaction)
    await expect(label(transaction, "decision")).toHaveText("COMMIT")
    await expect(label(transaction, "orderState")).toHaveText("✓")
    await expect(label(transaction, "jobState")).toHaveText("✓")
    await step(transaction)
    await expect(label(transaction, "workerState")).toHaveText("Claimed")
    await transaction.locator('[data-mode="rollback"]').focus()
    await page.keyboard.press("Space")
    await expect(transaction).toHaveAttribute("data-step", "0")
    for (let i = 0; i < 4; i++) await step(transaction)
    await expect(label(transaction, "decision")).toHaveText("ROLLBACK")
    await expect(label(transaction, "order")).toHaveText("—")
    await expect(label(transaction, "job")).toHaveText("—")
    await expect(label(transaction, "workerState")).toHaveText("No job")
    await expect(transaction.locator('.jv-wire[data-active="true"]')).toHaveCount(0)

    // Independent slots have no edge between them. Delivery exists only after handoff.
    assert.deepEqual(
      await handoff
        .locator(".jv-wire")
        .evaluateAll((paths) => paths.map((path) => path.dataset.connection)),
      ["confirmation", "invoice", "delivery"]
    )
    await step(handoff)
    await expect(label(handoff, "confirmationState")).toHaveText("Pending")
    await expect(label(handoff, "invoiceState")).toHaveText("Pending")
    await expect(label(handoff, "deliveryState")).toHaveText("—")
    await step(handoff)
    await expect(label(handoff, "confirmationState")).toHaveText("Active")
    await expect(label(handoff, "invoiceState")).toHaveText("Active")
    await step(handoff)
    await expect(label(handoff, "invoiceState")).toHaveText("Completed")
    await expect(label(handoff, "deliveryState")).toHaveText("Pending")
    await step(handoff)
    await expect(label(handoff, "deliveryState")).toHaveText("Active")
    await expect(label(handoff, "confirmationState")).toHaveText("Active")

    for (const variant of ["overview", "transaction", "handoff"]) {
      const figure = page.locator(`[data-job-visual="${variant}"]`)
      const boxes = await figure.locator(".jv-node").evaluateAll((nodes) =>
        nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          font: parseFloat(getComputedStyle(node.querySelector("strong")).fontSize)
        }))
      )
      assert(boxes.every((box) => box.width >= 110 && box.font >= 12))
      assert(
        await figure
          .locator(".jv-wire")
          .evaluateAll((paths) =>
            paths.every(
              (path) =>
                path.getTotalLength() > 10 && !path.getAttribute("d").includes("NaN")
            )
          )
      )
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      const name = `${variant}-${width}.png`
      await figure.screenshot({ path: join(output, name) })
      receipt.screenshots.push(name)
    }
    const markerIds = await page
      .locator(".jv-wires marker")
      .evaluateAll((nodes) => nodes.map((node) => node.id))
    assert.equal(new Set(markerIds).size, 3)

    if (width === 1440) {
      await reset(overview)
      await overview.getByRole("button", { name: "Play", exact: true }).click()
      const packet = overview.locator(".jv-packet").first()
      await expect.poll(() => packet.getAttribute("opacity")).not.toBe("0")
      await overview.getByRole("button", { name: "Pause", exact: true }).click()
      const frozen = await packet.getAttribute("transform")
      assert(frozen)
      await page.waitForTimeout(200)
      assert.equal(await packet.getAttribute("transform"), frozen)
      await overview.getByRole("button", { name: "Play", exact: true }).click()
      await expect(overview).toHaveAttribute("data-step", "5", { timeout: 12000 })
      await expect(overview).toHaveAttribute("data-playing", "false")
      await overview.getByRole("button", { name: "Replay", exact: true }).click()
      await expect(overview).toHaveAttribute("data-step", "0")
      await reset(overview)
      await overview.locator("[data-action=step]").focus()
      await page.keyboard.press("Enter")
      await expect(overview).toHaveAttribute("data-step", "1")
      await page.emulateMedia({ reducedMotion: "reduce" })
      await expect(overview.locator(".jv-play")).not.toBeVisible()
      await step(overview)
      await expect(overview).toHaveAttribute("data-step", "2")
      receipt.checks.push(
        "play/pause freezes packet; finite playback; replay; keyboard; reduced-motion manual stepping"
      )
    }
    // Observe clean disconnection/reconnection rather than leaving RAF/listeners alive.
    await handoff.evaluate((element) => {
      const parent = element.parentElement
      element.remove()
      parent.append(element)
    })
    await expect(handoff.locator(".jv-wire")).toHaveCount(3)
    await expect(handoff.locator(".jv-packet")).toHaveCount(3)
    receipt.checks.push(`responsive semantic states ${width}`)
    await page.close()
  }
  const noJs = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 1000 }
  })
  await noJs.goto(origin + "/docs/start/tutorial/")
  for (const variant of ["overview", "transaction", "handoff"]) {
    const figure = noJs.locator(`[data-job-visual="${variant}"]`)
    await expect(figure.locator(".jv-controls")).not.toBeVisible()
    await expect(figure.locator(".jv-static")).toBeVisible()
    await expect(figure.locator("figure")).toHaveAttribute("aria-label", /Illustration/)
    await figure.screenshot({ path: join(output, `${variant}-no-js.png`) })
  }
  await noJs.close()
  assert.deepEqual(receipt.pageErrors, [])
  assert.deepEqual(receipt.mutations, [])
  console.log(
    "PASS: 3 responsive illustrations; commit/rollback, after-commit worker, independent slots/handoff; playback/pause/replay, keyboard, reduced motion, noJS and cleanup; no mutation requests"
  )
} finally {
  await browser.close()
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
}
