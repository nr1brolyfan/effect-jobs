// Production browser FFI with synthetic HTTP only; never owner/runtime data.
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as Crypto from "../../../../packages/playground-contracts/dist/SyntheticCryptoFixture.js"
import { createServer } from "node:http"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import * as Fixtures from "../../../../packages/playground-contracts/dist/Fixtures.js"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
// Reuse the lockfile-pinned worker test dependency, never install a new package.
const workerRequire = createRequire(require.resolve("miniflare"))
const { WebSocketServer } = workerRequire("ws")
const assets = "apps/website/dist"
const output = resolve(".multica/shell-payload-evidence")
mkdirSync(output, { recursive: true })
const script = readFileSync(`${assets}/Client.js`)
const css = readFileSync(`${assets}/Jobs.css`)
const document = await Effect.runPromise(
  Crypto.sealSyntheticDocument({
    subject: "demo-customer",
    tenant: "demo-tenant-a",
    note: "shell-payload-fixture"
  })
)
const instant = Date.parse("2026-10-25T00:30:00.123Z")
const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 3600000 }
const jobs = Array.from({ length: 65 }, (_, n) => ({
  ...Fixtures.page.items[0],
  jobId: `synthetic-job-${String(n).padStart(3, "0")}`,
  state: n < 25 ? "Completed" : "Dead",
  updatedAt: instant,
  completedAt: instant
}))
const stats = { ...Fixtures.page.stats, total: 65, Completed: 25, Dead: 40 }
const errors = [],
  checks = []
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'"
  )
  if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("js") ? "text/javascript" : "text/css"
    )
    res.end(url.pathname.endsWith("js") ? script : css)
  } else if (url.pathname === "/api/demo") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(sandbox))
  } else if (url.pathname === "/api/demo/jobs") {
    const filtered = jobs.filter(
      (j) => !url.searchParams.get("state") || j.state === url.searchParams.get("state")
    )
    const offset = Number(url.searchParams.get("cursor") ?? 0)
    const limit = Number(url.searchParams.get("limit"))
    const page = {
      sandbox: sandbox.ref,
      attentionStats: Fixtures.page.attentionStats,
      filteredTotal: filtered.length,
      stats,
      items: filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null
    }
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(page))
  } else if (url.pathname === "/api/demo/jobs/detail") {
    const job = jobs.find((j) => j.jobId === url.searchParams.get("jobId"))
    res.setHeader("Content-Type", "application/json")
    res.end(
      JSON.stringify({
        ...Fixtures.detail,
        sandbox: sandbox.ref,
        job,
        payload: {
          _tag: "Available",
          formatVersion: 1,
          catalog: Crypto.syntheticDocumentCatalog,
          validation: "Valid",
          encryption: "SyntheticDocumentV1",
          encoded: { behavior: "success", document }
        }
      })
    )
  } else if (url.pathname === "/demo") {
    res.setHeader("Content-Type", "text/html")
    res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic UX qualification</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  } else {
    res.writeHead(404).end()
  }
})
const signals = new WebSocketServer({ server })
signals.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      kind: "ready",
      sandbox: sandbox.ref,
      reason: "reconcile",
      sequence: 1
    })
  )
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    window.copied = []
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => window.copied.push(text)
      }
    })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/demo`)
  await expect(page.locator(".job-list tr")).toHaveCount(20)
  await page.getByRole("tab", { name: "Dead 40", exact: true }).click()
  await expect(page.locator(".job-list tr").first()).toContainText("Dead")
  const originalUrl = page.url()
  const scope = await page.locator(".sandbox-scope").textContent()
  const controls = [
    page.getByRole("button", { name: "Playground workspace", exact: true }),
    page.locator(".sidebar-profile"),
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("button", { name: "Workspace", exact: true }),
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("button", { name: "Background Jobs", exact: true })
  ]
  for (const control of controls) {
    await expect(control).toBeEnabled()
    assert.equal(await control.evaluate((node) => node.tagName), "BUTTON")
    assert.equal(
      await control.evaluate((node) => getComputedStyle(node).cursor),
      "pointer"
    )
    const normal = await control.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    )
    await control.hover()
    await expect
      .poll(() => control.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(normal)
    const hovered = await control.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    )
    await page.mouse.down()
    await expect
      .poll(() => control.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(hovered)
    await page.mouse.up()
    await control.click()
    await control.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")
    assert.equal(await control.evaluate((node) => node.matches(":focus-visible")), true)
    assert.equal(
      await control.evaluate((node) => getComputedStyle(node).outlineStyle),
      "solid"
    )
    await page.keyboard.press("Tab")
    assert.equal(await control.evaluate((node) => node === document.activeElement), false)
    assert.equal(page.url(), originalUrl)
    await expect(page.getByRole("tab", { name: "Dead 40", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    assert.equal(await page.locator(".sandbox-scope").textContent(), scope)
  }
  assert.equal(await page.getByText("All data is synthetic.", { exact: true }).count(), 0)
  checks.push(
    "workspace/profile/breadcrumb native buttons: pointer, hover, focus-visible, Tab, Enter/Space/click preserve URL, filter and scope"
  )
  const panel = page.getByRole("region", { name: "Job payload", exact: true })
  const code = page.getByLabel("Demo unlock code", { exact: true })
  const unlock = page.getByRole("button", { name: "Unlock locally", exact: true })
  const relock = page.getByRole("button", { name: "Relock", exact: true })
  const verifyPayload = async () => {
    await expect(code).toHaveAttribute("placeholder", "Demo code: 123")
    await expect(
      page.getByText(
        /Synthetic demo data only|^Encoded JSON$|Readable JSON ·|Schema 1 · Valid/
      )
    ).toHaveCount(0)
    await code.fill("incorrect")
    await unlock.click()
    await expect(panel.getByRole("status")).toContainText("authentication failed")
    await code.fill("123")
    await code.press("Enter")
    await expect(page.getByLabel("Readable payload", { exact: true })).toContainText(
      "shell-payload-fixture"
    )
    await expect(code).toHaveValue("")
    await page.getByRole("button", { name: "Copy payload", exact: true }).click()
    await expect(panel.getByRole("status")).toHaveText("Payload copied.")
    assert.equal(
      await panel.locator("pre").textContent(),
      await page.evaluate(() => window.copied.at(-1))
    )
    await relock.click()
    await expect(page.getByLabel("Encoded payload", { exact: true })).toContainText(
      "ciphertext"
    )
  }
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: `${output}/shell-${width}.png`, fullPage: false })
    await page.locator("button[data-job-id]").first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1)
    await verifyPayload()
    await code.scrollIntoViewIfNeeded()
    if (width >= 1024) {
      const boxes = await Promise.all(
        [code, unlock, relock].map((node) => node.boundingBox())
      )
      assert.ok(
        boxes.every((box) => Math.abs(box.y - boxes[0].y) <= 1),
        JSON.stringify(boxes)
      )
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    assert.equal(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
      true
    )
    await panel.evaluate((node) => node.scrollIntoView({ block: "center" }))
    await page.screenshot({ path: `${output}/drawer-${width}.png`, fullPage: false })
    await page.getByRole("button", { name: "Open full details", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Job details", exact: true })
    ).toBeVisible()
    await verifyPayload()
    await code.scrollIntoViewIfNeeded()
    if (width >= 1024) {
      const boxes = await Promise.all(
        [code, unlock, relock].map((node) => node.boundingBox())
      )
      assert.ok(
        boxes.every((box) => Math.abs(box.y - boxes[0].y) <= 1),
        JSON.stringify(boxes)
      )
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.screenshot({ path: `${output}/fullpage-${width}.png`, fullPage: false })
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
    await expect(page.locator(".job-list tr")).toHaveCount(20)
  }
  checks.push(
    "production 1440/1024/390 shell, drawer and fullpage screenshots; drawer bounds/no overflow; single-row desktop unlock; wrong code, 123 via Enter, relock, exact displayed JSON copy"
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    `${output}/receipt.json`,
    JSON.stringify(
      {
        result: "PASS",
        scope: "production Client.js with synthetic HTTP/WS; no PG or owner preview",
        browser: browser.version(),
        checks,
        errors,
        clientSha256: createHash("sha256").update(script).digest("hex"),
        cssSha256: createHash("sha256").update(css).digest("hex")
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ result: "PASS", checks }))
} finally {
  await browser?.close()
  signals.close()
  await new Promise((done) => server.close(done))
}
