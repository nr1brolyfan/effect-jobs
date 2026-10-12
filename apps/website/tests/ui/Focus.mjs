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
  await expect(page.getByRole("region", { name: "Job details" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(row).toBeFocused()
  await row.click()
  await page.getByRole("button", { name: "Close details", exact: true }).click()
  await expect(row).toBeFocused()
  await row.click()
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(row).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Jobs list", exact: true })).toBeFocused()
  assert.equal(await page.getByRole("region", { name: "Job details" }).isVisible(), false)
  console.log(
    "PASS: Escape and Close details return focus to selected job; page eviction focuses Jobs list"
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
