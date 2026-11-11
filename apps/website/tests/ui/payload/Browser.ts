import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer, type Server } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import type { Browser } from "@playwright/test"
// Standalone tooling FFI; canonical Vite/StyleX build, complete retained browser oracle.
const { buildFixture } = (await import(
  new URL("../../modernization/FixtureServer.ts", import.meta.url).href
)) as typeof import("../../modernization/FixtureServer.js")
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test")
const output = resolve(".multica/payload-evidence/browser")
await mkdir(output, { recursive: true })
const { script, css } = await buildFixture("apps/website/tests/ui/payload/Render.tsx")
const inputs = {
  entry: "apps/website/tests/ui/payload/Render.tsx",
  compiler: "canonical Vite"
}
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
const axe = await readFile(require.resolve("axe-core/axe.min.js"))
const errors: string[] = [],
  checks: string[] = []
let server: Server | undefined, browser: Browser | undefined
const requests: Array<{ method: string; url: string; body: string | null }> = [],
  logs: string[] = []
declare global {
  interface Window {
    persisted: Array<{ key: string; value: string }>
    copied: string[]
    csp: string[]
    holdDecrypt: () => void
    decryptStarted: boolean
    decryptFinished: Promise<void>
    finishDecrypt: () => void
    releaseDecrypt: () => Promise<void>
    finishCopy: () => void
  }
}
try {
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store")
    if (req.url === "/Payload.js" || req.url === "/axe.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.end(req.url === "/axe.js" ? axe : script)
    } else if (req.url === "/Payload.css") {
      res.setHeader("Content-Type", "text/css")
      res.end(css)
    } else {
      res.setHeader("Content-Type", "text/html")
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'"
      )
      res.end(
        '<!doctype html><html lang="en"><head><title>Payload fixture</title><link rel="stylesheet" href="/Payload.css"></head><body><main id="fixture"></main><script type="module" src="/Payload.js"></script></body></html>'
      )
    }
  })
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done))
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => logs.push(message.text()))
  page.on("request", (request) =>
    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData()
    })
  )
  await page.addInitScript(() => {
    window.persisted = []
    window.copied = []
    window.csp = []
    Object.defineProperty(Storage.prototype, "setItem", {
      value: (key: string, value: string) => window.persisted.push({ key, value })
    })
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          window.copied.push(text)
        }
      }
    })
    document.addEventListener("securitypolicyviolation", (event) =>
      window.csp.push(event.violatedDirective)
    )
    const original = crypto.subtle.decrypt.bind(crypto.subtle)
    window.holdDecrypt = () => {
      window.decryptStarted = false
      window.decryptFinished = new Promise<void>((done) => {
        window.finishDecrypt = done
      })
      crypto.subtle.decrypt = (...args) => {
        window.decryptStarted = true
        return new Promise((resolve, reject) => {
          window.releaseDecrypt = async () => {
            crypto.subtle.decrypt = original
            try {
              resolve(await original(...args))
            } catch (error) {
              reject(error)
            }
            window.finishDecrypt()
          }
        })
      }
    }
  })
  await page.goto(
    `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`
  )
  const plain = page.getByLabel("Readable payload")
  const unlock = async () => {
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(plain).toContainText("payload-browser-secret-synthetic")
  }
  const locked = async () => {
    await expect(plain).toHaveCount(0)
  }
  await expect(page.getByText(/Synthetic demo data only/)).toHaveCount(0)
  await expect(page.getByLabel("Demo unlock code")).toHaveAttribute(
    "placeholder",
    "Demo code: 123"
  )
  await expect(page.locator("details")).toHaveCount(0)
  await expect(page.getByText(/Shape validation does not verify/)).toHaveCount(0)
  await expect(
    page.getByText(/Schema 1 · Valid|^Encoded JSON$|Readable JSON ·/)
  ).toHaveCount(0)
  await page.getByLabel("Demo unlock code").fill("321")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("authentication failed")
  await locked()
  await unlock()
  await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
  await expect(page.getByRole("status")).toContainText("verified locally")
  await expect(page.locator('section[aria-label="Job payload"] pre')).toHaveCount(1)
  await expect(plain).toContainText('"sandboxId": "fixture-sandbox"')
  await expect(plain).toContainText('"behavior": "success"')
  await expect(plain).toContainText('"document": {')
  await expect(plain).not.toContainText('"ciphertext"')
  const copyDisplayed = async () => {
    const displayed = await page
      .locator('section[aria-label="Job payload"] pre')
      .textContent()
    await page.getByRole("button", { name: "Copy payload", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText("Payload copied.")
    assert.equal(await page.evaluate(() => window.copied.at(-1)!), displayed)
  }
  await copyDisplayed()
  assert.ok(
    (await page.evaluate(() => window.copied.at(-1)!)).includes(
      "payload-browser-secret-synthetic"
    )
  )
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await copyDisplayed()
  assert.ok(
    JSON.parse(await page.evaluate(() => window.copied.at(-1)!)).document.ciphertext
  )
  await page.getByRole("button", { name: "Change mode", exact: true }).click()
  await locked()
  await unlock()
  await copyDisplayed()
  checks.push(
    "synthetic displayed JSON copying in both modes; encoded after relock; no explanatory hint DOM"
  )
  for (const action of ["Relock", "Change mode", "Change generation", "Change job"]) {
    if ((await plain.count()) === 0) {
      await unlock()
    }
    await page.getByRole("button", { name: action, exact: true }).click()
    await locked()
    await expect(page.getByLabel("Encoded payload")).toContainText("ciphertext")
    await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
    await copyDisplayed()
  }
  for (const event of ["pagehide", "popstate"]) {
    await unlock()
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), event)
    await locked()
  }
  for (const action of ["Close fixture", "Expire fixture"]) {
    await unlock()
    await page.getByRole("button", { name: action, exact: true }).click()
    await locked()
    await page.getByRole("button", { name: "Open fixture", exact: true }).click()
    await locked()
  }
  checks.push(
    "StrictMode close/unmount/expiry integration signal, mode, generation, job, pagehide, popstate relock"
  )
  for (const action of ["Relock", "Close fixture", "Change generation", "Change mode"]) {
    await page.evaluate(() => window.holdDecrypt())
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.decryptStarted)).toBe(true)
    await page.getByRole("button", { name: action, exact: true }).click()
    await page.evaluate(async () => {
      await window.releaseDecrypt()
      await window.decryptFinished
    })
    if (action === "Close fixture") {
      await page.getByRole("button", { name: "Open fixture", exact: true }).click()
    }
    await locked()
    await expect(page.getByRole("status")).toContainText("Locked")
    await unlock()
    await page.getByRole("button", { name: "Relock", exact: true }).click()
  }
  checks.push(
    "held native decrypt completions after relock/close/generation/mode never republish plaintext; fresh unlock still works"
  )
  await page.getByRole("button", { name: "Tamper fixture" }).click()
  await page.getByLabel("Demo unlock code").fill("123")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("authentication failed")
  await locked()
  await page.getByRole("button", { name: "Unsupported fixture" }).click()
  await expect(page.getByText(/Unlock unavailable: unsupported/)).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Unlock locally", exact: true })
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Missing fixture" }).click()
  await expect(page.getByLabel("Payload unavailable: not stored.")).toHaveText("—")
  await expect(page.getByRole("button", { name: "Copy payload" })).toHaveCount(0)
  await page.getByRole("button", { name: "Compatible private fixture" }).click()
  const enc = page.getByLabel("Local encryption key (hex)")
  const fp = page.getByLabel("Local fingerprint key (hex)")
  await enc.fill("01".repeat(32))
  await fp.fill("01".repeat(32))
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("authentication failed")
  await locked()
  await expect(enc).toHaveValue("")
  await expect(fp).toHaveValue("")
  const hex = (start: number) =>
    Array.from({ length: 32 }, (_, i) => (i + start).toString(16).padStart(2, "0")).join(
      ""
    )
  await enc.fill(hex(1))
  await fp.fill(hex(101))
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(plain).toContainText("payload-browser-secret-synthetic")
  if ((await page.getByRole("button", { name: "Copy payload" }).count()) === 0) {
    await page.getByRole("button", { name: "Change mode", exact: true }).click()
    await enc.fill(hex(1))
    await fp.fill(hex(101))
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(plain).toContainText("payload-browser-secret-synthetic")
  }
  await page.getByRole("button", { name: "Copy payload", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Payload copied.")
  assert.ok(
    JSON.parse(await page.evaluate(() => window.copied.at(-1)!)).document.ciphertext
  )
  assert.equal(
    await plain.evaluate((node) =>
      node.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }))
    ),
    false
  )
  checks.push(
    "real PrivateDocumentV1 keeps encoded-only button and blocks selection-copy after successful local decrypt"
  )
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await page.getByRole("button", { name: "Plain fixture" }).click()
  await expect(page.getByLabel("Encoded payload")).toContainText(
    "<script>never-execute</script>"
  )
  assert.equal(await page.locator("script").count(), 1)
  if ((await page.getByRole("button", { name: "Copy payload" }).count()) === 0) {
    await page.getByRole("button", { name: "Change mode", exact: true }).click()
  }
  await page.getByRole("button", { name: "Copy payload" }).click()
  assert.equal(JSON.parse(await page.evaluate(() => window.copied.at(-1)!)).value, 42)
  const tokenColors = await page
    .getByLabel("Encoded payload")
    .locator("span")
    .evaluateAll((nodes) => [
      ...new Set(nodes.map((node) => getComputedStyle(node).color))
    ])
  assert.ok(tokenColors.length >= 3)
  checks.push(
    "tamper/unsupported/missing remain locked; two locally supplied private keys; escaped JSON, compiled syntax colors and unencrypted copy"
  )
  await page.getByRole("button", { name: "Open fixture", exact: true }).click()
  await unlock()
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))
  })
  await page.getByRole("button", { name: "Copy payload", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Clipboard unavailable.")
  await page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      new Promise((resolve) => {
        window.finishCopy = resolve
      })
  })
  await page.getByRole("button", { name: "Copy payload", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Copying payload…")
  await expect(
    page.getByRole("button", { name: "Copy payload", exact: true })
  ).toBeDisabled()
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await page.evaluate(() => window.finishCopy())
  await expect(page.getByRole("status")).toHaveText("Locked.")
  checks.push(
    "accessible honest asynchronous clipboard failure/pending feedback; relock revokes stale completion"
  )
  await unlock()
  await page.addScriptTag({ url: "/axe.js" })
  const audit = async () =>
    assert.deepEqual(
      await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
          })
        ).violations.map((violation) => violation.id)
      ),
      []
    )
  await audit()
  const borders = await page
    .locator(
      'section[aria-label="Job payload"], section[aria-label="Job payload"] pre, section[aria-label="Job payload"] dl'
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        return {
          width: style.borderTopWidth,
          style: style.borderTopStyle,
          color: style.borderTopColor
        }
      })
    )
  assert.equal(borders.length, 2)
  assert.ok(
    borders.every(
      (border) =>
        border.width === "1px" &&
        border.style === "solid" &&
        border.color === "rgb(55, 68, 49)"
    )
  )
  assert.equal(
    await page
      .locator(
        'section[aria-label="Job payload"] [style], section[aria-label="Job payload"][style]'
      )
      .count(),
    0
  )
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await audit()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true
  )
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true })
  assert.deepEqual(await page.evaluate(() => window.persisted), [])
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
  assert.deepEqual(await page.evaluate(() => window.csp), [])
  assert.equal(await page.locator("style").count(), 0)
  assert.ok(
    requests.every(
      (request) =>
        request.method === "GET" && !request.body && !request.url.includes("secret")
    )
  )
  assert.ok(logs.every((log) => !log.includes("payload-browser-secret-synthetic")))
  assert.ok(
    !(await page.evaluate(() =>
      JSON.stringify(history.state).includes("payload-browser-secret-synthetic")
    ))
  )
  assert.deepEqual(errors, [])
  checks.push(
    "desktop/mobile axe, no horizontal overflow, extracted CSS/CSP, no plaintext/keys in storage/network/logs/history"
  )
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS",
        scope:
          "isolated component with synthetic test detail; not recorded PG demo qualification",
        inputs,
        scriptSha256: hash(script),
        cssSha256: hash(css),
        browser: browser.version(),
        checks,
        errors
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ result: "PASS", checks, browser: browser.version() }))
} finally {
  await browser?.close()
  if (server) {
    await new Promise<void>((done, reject) =>
      server!.close((error) => (error ? reject(error) : done()))
    )
  }
}
