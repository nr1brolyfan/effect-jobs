import assert from "node:assert/strict"
import { afterAll, beforeAll, test } from "vitest"
import { expect, type Browser, type Page } from "@playwright/test"
import { launch, serveFixture } from "./FixtureServer.js"
import type {} from "../ui/BrowserEntry.js"

let browser: Browser
let server: Awaited<ReturnType<typeof serveFixture>>
beforeAll(async () => {
  server = await serveFixture("apps/website/tests/ui/BrowserEntry.ts", "jobs")
  try {
    browser = await launch()
  } catch (error) {
    await server.close()
    throw error
  }
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const connected = (page: Page) =>
  expect(page.locator('.connection-status[data-connection="connected"]')).toBeVisible()
const rows = (page: Page) => page.locator(".job-list tr")

// Exact default, row identities, next cursor and state filter replace the stale
// five-row assumption without claiming synthetic HTTP proves PG pagination.
test("default page size is 20; opaque cursor and filtered rows survive reconciliation", async () => {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(server.origin + "/jobs")
    await connected(page)
    await expect(rows(page)).toHaveCount(20)
    await expect(
      page.getByRole("button", { name: "demo-job-01", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "demo-job-20", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "demo-job-21", exact: true })
    ).toHaveCount(0)
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await connected(page)
    await expect(rows(page)).toHaveCount(20)
    await expect(rows(page).first().locator("button[data-job-id]")).toHaveText(
      "demo-job-21"
    )
    const cursor = await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor)
    await page.evaluate(() => {
      window.jobsBrowserTest.update()
      return window.jobsBrowserTest.reconcile()
    })
    await expect(rows(page).first()).toContainText("Completed")
    assert.equal(
      await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor),
      cursor
    )
    await page.evaluate(() => window.jobsBrowserTest.mode("invalid-cursor"))
    await page.evaluate(() => window.jobsBrowserTest.reconcile())
    await expect(page.locator(".connection-status")).toContainText("invalid-request")
    assert.equal(
      await page.evaluate(() => window.jobsBrowserTest.snapshot().cursor),
      cursor
    )
    await page.evaluate(() => window.jobsBrowserTest.mode("normal"))
    await page.getByRole("button", { name: "First page", exact: true }).click()
    await connected(page)
    await page.getByRole("tab", { name: /^Dead/ }).click()
    await connected(page)
    await expect(rows(page)).toHaveCount(8)
    await page.evaluate(() => window.jobsBrowserTest.mode("error"))
    await page.evaluate(() => window.jobsBrowserTest.reconcile())
    await expect(page.locator(".connection-status")).toContainText("unavailable")
    await expect(rows(page)).toHaveCount(8)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test("unknown command outcome and absent receipt never replay the write", async () => {
  const page = await browser.newPage()
  try {
    await page.goto(server.origin + "/jobs?commands=1")
    await connected(page)
    await page.getByRole("button", { name: "Create jobs", exact: true }).click()
    await page.getByLabel("Fake provider behavior").selectOption("unknown-outcome")
    await page.getByLabel("Jobs (1–10)").fill("2")
    await page.getByRole("button", { name: "Run scenario", exact: true }).click()
    const launcher = page.getByRole("region", { name: "Scenario launcher" })
    await expect(launcher).toContainText("Outcome unknown. Do not replay")
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true })
    ).toBeDisabled()
    await expect(
      page.getByRole("button", { name: "Reset my sandbox", exact: true })
    ).toBeDisabled()
    await page
      .getByRole("button", { name: "Check exact request receipt", exact: true })
      .click()
    await expect(launcher).toContainText("Absence does not authorize replay")
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.evaluate(() => window.jobsBrowserTest.reconcile())
    assert.equal(await page.evaluate(() => window.jobsBrowserTest.runs()), 1)
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true })
    ).toBeDisabled()
  } finally {
    await page.close()
  }
})

test("visible polling refreshes; disposal stops reads and events beyond the next poll", async () => {
  const page = await browser.newPage()
  try {
    await page.goto(server.origin + "/jobs?poll=1")
    await connected(page)
    const initial = await page.evaluate(() => window.jobsBrowserTest.requests().length)
    await expect
      .poll(() => page.evaluate(() => window.jobsBrowserTest.requests().length), {
        timeout: 8_000
      })
      .toBeGreaterThan(initial)
    await page.evaluate(() => window.jobsBrowserTest.dispose())
    await expect(page.locator("main")).toBeEmpty()
    const disposed = await page.evaluate(() => ({
      reads: window.jobsBrowserTest.requests().length,
      descriptions: window.jobsBrowserTest.descriptions(),
      runs: window.jobsBrowserTest.runs()
    }))
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"))
      window.dispatchEvent(new Event("offline"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // Observation window deliberately exceeds the production five-second poll.
    // The runtime owner's TestClock tests cover scheduler internals separately.
    await page.waitForTimeout(5_500)
    assert.deepEqual(
      await page.evaluate(() => ({
        reads: window.jobsBrowserTest.requests().length,
        descriptions: window.jobsBrowserTest.descriptions(),
        runs: window.jobsBrowserTest.runs()
      })),
      disposed
    )
    await expect(page.locator("main")).toBeEmpty()
  } finally {
    await page.close()
  }
})

test("Escape/Close restore row focus; eviction uses the safe list fallback", async () => {
  const page = await browser.newPage()
  try {
    await page.goto(server.origin + "/jobs")
    await connected(page)
    const row = page.getByRole("button", { name: "demo-job-02", exact: true })
    await row.click()
    await expect(
      page.getByRole("button", { name: "Close job details", exact: true })
    ).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(row).toBeFocused()
    await row.click()
    await page.getByRole("button", { name: "Close job details", exact: true }).click()
    await expect(row).toBeFocused()
    await row.click()
    await page.evaluate(() => window.jobsBrowserTest.next())
    await expect(row).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(
      page
        .getByRole("region", { name: "Jobs list", exact: true })
        .getByRole("tab", { name: /^All jobs/ })
    ).toBeFocused()
  } finally {
    await page.close()
  }
})
