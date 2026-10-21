// Browser FFI regression: closing details must focus the selected row after React commits.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
// Original Browser.mjs builds this fixture; use the identical compiled sources.
const files = {
  "/BrowserEntry.js": [
    readFileSync(".multica/ui-browser/BrowserEntry.js"),
    "text/javascript"
  ],
  "/Jobs.css": [readFileSync(".multica/ui-browser/Jobs.css"), "text/css"],
  "/jobs": [
    readFileSync("apps/website/src/features/jobs/Fixture.html", "utf8").replace(
      "/FixtureEntry.js",
      "/BrowserEntry.js"
    ),
    "text/html"
  ]
}
const server = createServer((request, response) => {
  const entry = files[request.url]
  if (!entry) {
    response.writeHead(404).end()
    return
  }
  response.setHeader("Content-Type", entry[1])
  response.end(entry[0])
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs`)
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
  // A modal makes background controls inert; model a live page change through the owned runtime.
  await page.evaluate(() => window.jobsBrowserTest.next())
  await expect(row).toHaveCount(0)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const fallback = page.getByRole("region", { name: "Jobs list", exact: true })
  // Base UI 1.9 resolves a non-tabbable finalFocus container to its first tabbable
  // descendant. Assert the exact safe list target, rather than the old non-modal container.
  await expect(fallback.getByRole("tab", { name: /^All jobs/ })).toBeFocused()
  assert(await fallback.evaluate((node) => node.contains(document.activeElement)))
  assert.equal(await page.getByRole("dialog").isVisible(), false)
  console.log(
    "PASS: Escape and Close details return focus to selected job; page eviction focuses Jobs list"
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
