// Run against an explicitly started disposable HTTP preview, never a hosted instance.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const origin = new URL(process.env.PLAYGROUND_PREVIEW_ORIGIN)
assert.equal(origin.protocol, "http:")
assert.equal(origin.hostname, "127.0.0.1")
const require = createRequire(
  resolve(process.env.UI_PLAYWRIGHT_PACKAGE ?? ".multica/browser/package.json")
)
const { chromium } = require("playwright")
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  const connected = () =>
    page.locator('.connection-status[data-connection="connected"]').waitFor()
  await page.goto(new URL("/jobs", origin).href)
  await connected()
  const name = `playground-local-${origin.port}`
  const credential = (await context.cookies()).find((cookie) => cookie.name === name)
  assert(credential?.httpOnly)
  assert.equal(credential.secure, false)
  await page.reload()
  await connected()
  assert.equal(
    (await context.cookies()).find((cookie) => cookie.name === name).value,
    credential.value
  )
  // Keep the real CSRF cookie but replace the credential with a previous DB's invalid token.
  await context.addCookies([{ ...credential, value: "obsolete-preview-credential" }])
  await page.reload()
  await connected()
  assert.notEqual(
    (await context.cookies()).find((cookie) => cookie.name === name).value,
    "obsolete-preview-credential"
  )
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await page.getByLabel("Jobs (1–10)").fill("3")
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await page.getByText(/Enqueue acknowledged for/).waitFor()
  await page
    .getByRole("row")
    .filter({ hasText: "Completed" })
    .first()
    .waitFor({ timeout: 20000 })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "HTTP without TLS exceptions",
        "port-scoped HttpOnly cookie",
        "valid session preserved",
        "obsolete credential recovered",
        "real scenario completed"
      ]
    })
  )
  await context.close()
} finally {
  await browser.close()
}
