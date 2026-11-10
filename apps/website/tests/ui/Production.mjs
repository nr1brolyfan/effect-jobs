// Production artifact regression with synthetic HTTP responses, no backend claims.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import * as Fixtures from "../../../../packages/playground-contracts/dist/Fixtures.js"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const script = readFileSync("apps/website/dist/Client.js")
const css = readFileSync("apps/website/dist/Jobs.css")
const errors = []
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  if (path === "/Client.js" || path === "/Jobs.css") {
    res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css")
    res.end(path.endsWith("js") ? script : css)
  } else if (path === "/api/demo") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ...Fixtures.sandbox, expiresAt: Date.now() + 60000 }))
  } else if (path === "/api/demo/jobs") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(Fixtures.page))
  } else if (path === "/demo") {
    res.setHeader("Content-Type", "text/html")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'"
    )
    res.end(
      '<!doctype html><html lang="en"><head><title>Production fixture</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  } else {
    res.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/demo`)
  await expect(page.locator(".job-list tr")).toHaveCount(Fixtures.page.items.length)
  await expect(
    page.getByRole("heading", { name: "Background Jobs", exact: true })
  ).toBeVisible()
  assert.equal(
    await page
      .locator(".jobs-app")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(16, 21, 16)"
  )
  assert.equal(await page.locator("style").count(), 0)
  assert.deepEqual(errors, [])
  const evidence = resolve(".multica/react-qualification")
  mkdirSync(evidence, { recursive: true })
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
  writeFileSync(
    `${evidence}/production-fixture.json`,
    JSON.stringify(
      {
        result: "PASS",
        source: "production Client.js with synthetic HTTP, no PG/WS qualification",
        clientSha256: hash(script),
        cssSha256: hash(css),
        browser: browser.version(),
        checks: [
          "production JSX bindings execute",
          "production HTTP bootstrap renders authoritative fixture",
          "compiled semantic canvas styling",
          "no injected style elements"
        ]
      },
      null,
      2
    ) + "\n"
  )
  console.log("PASS: production Client.js HTTP bootstrap and extracted CSS in Chromium")
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
