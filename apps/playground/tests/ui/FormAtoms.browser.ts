// Finite browser FFI, synthetic fixtures only. Uses the canonical Vite/StyleX config.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { build } from "vite"
import { chromium, expect, type Browser } from "@playwright/test"

const output = resolve(".multica/ui-lifecycle")
await mkdir(output, { recursive: true })
await build({
  root: resolve("apps/playground"),
  configFile: resolve("apps/playground/vite.config.ts"),
  mode: "fixtures",
  build: {
    outDir: output,
    lib: {
      entry: resolve("apps/playground/tests/ui/FormAtoms.render.tsx"),
      formats: ["es"]
    }
  }
})
const script = await readFile(resolve(output, "FixtureEntry.js"))
const css = await readFile(resolve(output, "Jobs.css"))
const errors: string[] = []
const server = createServer((request, response) => {
  const path = new URL(request.url!, "http://localhost").pathname
  response.setHeader(
    "Content-Type",
    path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : "text/html"
  )
  response.end(
    path === "/FixtureEntry.js"
      ? script
      : path === "/Jobs.css"
        ? css
        : '<!doctype html><html lang="en"><head><title>UI lifecycle</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="fixture"></main><div id="list"></div><script type="module" src="/FixtureEntry.js"></script></body></html>'
  )
})
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
assert(address && typeof address === "object")
let browser: Browser | undefined
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await expect(page.getByLabel("First", { exact: true })).toHaveValue("")
  await page.getByLabel("First", { exact: true }).fill("ephemeral-form-value")
  await expect(page.getByLabel("Second", { exact: true })).toHaveValue("")
  await expect(page.locator(".job-list tr")).toHaveCount(13)
  const commits = await page.evaluate(() => window.uiProof.commits())
  await page.evaluate(() => {
    window.uiProof.tick()
    window.uiProof.notice()
  })
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      )
  )
  assert.equal(
    await page.evaluate(() => window.uiProof.commits()),
    commits,
    "clock and receipts do not render the list"
  )
  const unlock = async () => {
    await page.getByLabel("Demo unlock code", { exact: true }).fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(page.getByLabel("Readable payload", { exact: true })).toContainText(
      "volatile-synthetic-ui-secret"
    )
    await expect(page.getByLabel("Session document", { exact: true })).toHaveText(
      "volatile-synthetic-ui-secret"
    )
  }
  await unlock()
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await expect(page.getByLabel("Encoded payload", { exact: true })).not.toContainText(
    "volatile-synthetic-ui-secret"
  )
  await expect(page.getByLabel("Session document", { exact: true })).toHaveText("locked")
  await unlock()
  await page.getByRole("button", { name: "Change generation", exact: true }).click()
  await expect(page.getByLabel("Encoded payload", { exact: true })).toBeVisible()
  await expect(page.getByLabel("First", { exact: true })).toHaveValue("")
  await unlock()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))
  await expect(page.getByLabel("Encoded payload", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Session document", { exact: true })).toHaveText("locked")
  await unlock()
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")))
  await expect(page.getByLabel("Encoded payload", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Close detail", exact: true }).click()
  await page.getByRole("button", { name: "Complete old callback", exact: true }).click()
  await page.getByRole("button", { name: "Open detail", exact: true }).click()
  await expect(page.getByLabel("First", { exact: true })).toHaveValue("")
  await expect(page.getByLabel("Encoded payload", { exact: true })).toBeVisible()
  // A completion from a closed detail may never unlock the replacement detail.
  await page.evaluate(() => {
    const original = crypto.subtle.decrypt.bind(crypto.subtle)
    let resume: (() => void) | undefined
    Object.assign(window, { finishOldDecrypt: () => resume?.() })
    crypto.subtle.decrypt = (...args) =>
      new Promise((resolve, reject) => {
        resume = () => {
          void original(...args).then(resolve, reject)
        }
      })
  })
  await page.getByLabel("Demo unlock code", { exact: true }).fill("123")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Unlock locally", exact: true })
  ).toBeDisabled()
  await page.getByRole("button", { name: "Close detail", exact: true }).click()
  await page.evaluate(() =>
    (window as unknown as { finishOldDecrypt: () => void }).finishOldDecrypt()
  )
  await page.getByRole("button", { name: "Open detail", exact: true }).click()
  await expect(page.getByLabel("Encoded payload", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Session document", { exact: true })).toHaveText("locked")
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.uiProof.dispose())
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS",
        checks: [
          "StrictMode field isolation",
          "no list commits on clock/receipt updates",
          "authenticated local unlock",
          "relock revokes shared document",
          "generation remount clears plaintext and forms",
          "pagehide/popstate revoke",
          "stale callback cannot resurrect unmounted form",
          "late decrypt cannot unlock replacement detail"
        ],
        scriptSha256: createHash("sha256").update(script).digest("hex"),
        cssSha256: createHash("sha256").update(css).digest("hex"),
        browser: browser.version()
      },
      null,
      2
    )
  )
  console.log("PASS: scoped form/plaintext lifetime and independent list subscriptions")
} finally {
  await browser?.close()
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
