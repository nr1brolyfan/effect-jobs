import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "vitest"
import { expect, type Browser } from "@playwright/test"
import type axe from "axe-core"
import { launch, serveFixture } from "./FixtureServer.js"

declare global {
  interface Window {
    axe: typeof axe
  }
}
const require = createRequire(import.meta.url)

test("detail drawer/full/history preserve focus, filters, generation and volatile payload lifetime", async () => {
  const errors: string[] = []
  const checks: string[] = []
  const server = await serveFixture("apps/website/tests/ui/details/Details.render.tsx")
  let browser: Browser | undefined
  try {
    browser = await launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(5000)
    page.on("pageerror", (error) => errors.push(error.message))
    const origin = server.origin
    const audit = async () => {
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") })
      const violations = await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
          })
        ).violations.map((item) => ({
          id: item.id,
          targets: item.nodes.map((node) => node.target)
        }))
      )
      assert.deepEqual(violations, [])
    }
    await page.goto(`${origin}/jobs`)
    const trigger = page.getByRole("button", { name: "Inspect synthetic source" })
    await trigger.click()
    await expect(page.getByRole("dialog", { name: "Quick job details" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Close job details" })).toBeFocused()
    await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
    await expect(page.getByText("UNLOCKED SYNTHETIC SENTINEL")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(trigger).toBeFocused()
    assert.equal(await page.locator("html").getAttribute("data-slot-unmounts"), "1")
    await trigger.click()
    await expect(page.getByText("Locked synthetic payload")).toBeVisible()
    await audit()
    await page.getByRole("button", { name: "Close job details" }).click()
    await expect(trigger).toBeFocused()
    checks.push(
      "named Base UI dialog, initial focus, Escape/Close restoration and payload slot unmount/relock"
    )
    await trigger.click()
    await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
    await page.getByRole("button", { name: "Open full details" }).click()
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeFocused()
    await expect(page.getByText("Locked synthetic payload")).toBeVisible()
    assert.match(page.url(), /\/jobs\/synthetic-source\?generation=1$/)
    await expect(
      page.getByText("About counters & resolution", { exact: true })
    ).toHaveCount(0)
    await expect(page.locator("summary")).toHaveText(["Identity & execution policy"])
    await expect(
      page.locator('[aria-label="Handler result is not stored"]')
    ).toBeVisible()
    await expect(page.locator('[aria-label="Handler result is not stored"]')).toHaveText(
      "—"
    )
    await expect(page.getByText("Attempts finalized", { exact: true })).toBeVisible()
    await audit()
    await page.getByRole("button", { name: "Toggle synthetic unlock" }).click()
    await page
      .getByRole("button", { name: "Open related job synthetic-successor" })
      .click()
    await expect(page.getByText("Locked synthetic payload")).toBeVisible()
    assert.match(page.url(), /\/jobs\/synthetic-successor\?generation=1$/)
    await page.goBack()
    await expect(trigger).toBeFocused()
    await expect(page.locator("#return-context")).toHaveText(
      "Page 3; Dead; (not retained); fixture-3"
    )
    assert((await page.evaluate(() => scrollY)) > 0)
    assert.equal(await page.evaluate(() => history.state), null)
    checks.push(
      "full page and same-mode related routes, identity relock, real history Back with volatile filters/page/cursors/scroll/focus"
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await trigger.click()
    await audit()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.getByRole("button", { name: "Open full details" }).click()
    await audit()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    checks.push(
      "390px drawer/full page no horizontal overflow and desktop/mobile WCAG axe passes"
    )
    await page.goto(`${origin}/demo/jobs/synthetic-source?generation=1`)
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "Back to jobs" }).click()
    assert.equal(page.url(), `${origin}/demo`)
    await page.goto(`${origin}/demo/jobs/synthetic-source?generation=2`)
    await expect(page.getByRole("heading", { name: "Details unavailable" })).toBeVisible()
    await expect(page.getByText("UNLOCKED SYNTHETIC SENTINEL")).toHaveCount(0)
    checks.push(
      "direct demo detail/list fallback and stale generation never retargets identity"
    )
    await page.goto(`${origin}/jobs?name-filter=1`)
    await trigger.click()
    await page.getByRole("button", { name: "Open full details" }).click()
    await page.getByRole("button", { name: "Back to jobs" }).click()
    await expect(
      page.getByRole("button", { name: "Jobs list", exact: true })
    ).toBeFocused()
    await expect(page.locator("#return-context")).toHaveText(
      "Page 1; Dead; (not retained); undefined"
    )
    assert(!page.url().includes("name="))
    assert(!page.url().includes("synthetic.kind"))
    assert.equal(await page.evaluate(() => history.state), null)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
}, 90_000)
