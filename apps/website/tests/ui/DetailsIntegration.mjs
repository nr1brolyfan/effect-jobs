// Production Client.js + real crypto, synthetic HTTP fixtures. No stored-PG claim.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { Effect } from "effect"
import * as Fixtures from "../../../../packages/playground-contracts/dist/Fixtures.js"
import * as Crypto from "../../../../packages/playground-contracts/dist/SyntheticCryptoFixture.js"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const encodedDocument = await Effect.runPromise(
  Crypto.sealSyntheticDocument({
    subject: "demo-customer",
    tenant: "demo-tenant-a",
    note: "Synthetic browser integration fixture"
  })
)
const summary = { ...Fixtures.detail.job, catalog: Crypto.syntheticDocumentCatalog }
const detail = {
  ...Fixtures.detail,
  job: summary,
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: summary.catalog,
    encoded: {
      sandbox: Fixtures.sandbox.ref,
      version: 1,
      seed: 123,
      sequence: 1,
      behavior: "success",
      actor: "demo-customer",
      tenant: "demo-tenant-a",
      order: "demo-order-a",
      document: encodedDocument
    },
    validation: "Valid",
    encryption: "SyntheticDocumentV1"
  }
}
const script = readFileSync("apps/website/dist/Client.js"),
  css = readFileSync("apps/website/dist/Jobs.css")
const html =
  '<!doctype html><html lang="en"><head><title>Details integration</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
const requests = [],
  errors = []
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  requests.push({ path: url.pathname, method: req.method })
  res.setHeader("Cache-Control", "no-store")
  if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("js") ? "text/javascript" : "text/css"
    )
    res.end(url.pathname.endsWith("js") ? script : css)
    return
  }
  if (url.pathname === "/demo" || url.pathname.startsWith("/demo/jobs/")) {
    res.setHeader("Content-Type", "text/html")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'"
    )
    res.end(html)
    return
  }
  res.setHeader("Content-Type", "application/json")
  if (url.pathname === "/api/demo") {
    res.end(JSON.stringify({ ...Fixtures.sandbox, expiresAt: Date.now() + 120000 }))
  } else if (url.pathname === "/api/demo/jobs") {
    res.end(JSON.stringify({ ...Fixtures.page, items: [summary] }))
  } else if (url.pathname === "/api/demo/jobs/detail") {
    res.end(JSON.stringify(detail))
  } else {
    res.writeHead(404)
    res.end('{"code":"not-found"}')
  }
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const host of ["127.0.0.1", "localhost"]) {
    const page = await browser.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    const origin = `http://${host}:${server.address().port}`
    await page.goto(origin + `/demo/jobs/${summary.jobId}?generation=1`)
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await page.getByLabel("Synthetic unlock code", { exact: true }).fill("000")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(
      page.getByLabel("Locally decrypted document", { exact: true })
    ).toHaveCount(0)
    await page.getByLabel("Synthetic unlock code", { exact: true }).fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(
      page.getByLabel("Locally decrypted document", { exact: true })
    ).toContainText("Synthetic browser integration fixture")
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0]
    )
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(1)
    await expect(
      page.getByLabel("Locally decrypted document", { exact: true })
    ).toHaveCount(0)
    await page.getByRole("button", { name: summary.jobId, exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Open full details", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel("Locally decrypted document", { exact: true })
    ).toHaveCount(0)
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(1)
    await expect(
      page.getByRole("button", { name: summary.jobId, exact: true })
    ).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: summary.jobId, exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Close job details", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.close()
  }
  assert.deepEqual(errors, [])
  assert(
    !requests.some((r) => r.path.startsWith("/api/") && !r.path.startsWith("/api/demo"))
  )
  assert(!requests.some((r) => r.method === "POST"))
  console.log(
    JSON.stringify({
      result: "PASS",
      runtime: browser.version(),
      source:
        "production artifacts + synthetic HTTP; PG stored fixture and real worker NotTested",
      checks: [
        "nested demo direct link uses GET-only demo bootstrap",
        "code123 real crypto/wrong code",
        "no storage writes",
        "Back/drawer/full/close relock",
        "post-layout return focus",
        "both loopback aliases",
        "mobile drawer",
        "zero browser errors/private requests"
      ]
    })
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
