import type {
  JobRepairCommand,
  JobResolutionCommand
} from "@effect-jobs/playground-contracts/Repairs"
import type {} from "../../modernization/Details.e2e.js"
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
const output = resolve(".toolchain/repairs/browser")
await mkdir(output, { recursive: true })
const { script, css } = await buildFixture(
  "apps/website/tests/ui/repair/Panel.render.tsx"
)
const inputs = {
  entry: "apps/website/tests/ui/repair/Panel.render.tsx",
  compiler: "canonical Vite"
}
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
const axe = await readFile(require.resolve("axe-core/axe.min.js"))
const errors: string[] = [],
  checks: string[] = []
let server: Server | undefined, browser: Browser | undefined
declare global {
  interface Window {
    repairFixture: {
      commands: Array<JobRepairCommand | JobResolutionCommand>
      receipts: () => number
      reset: () => void
      revise: () => void
      readonly: () => void
      encrypted: () => void
      uncertain: () => void
    }
  }
}
try {
  server = createServer((req, res) => {
    if (req.url === "/Panel.js" || req.url === "/axe.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.end(req.url === "/Panel.js" ? script : axe)
    } else if (req.url === "/Panel.css") {
      res.setHeader("Content-Type", "text/css")
      res.end(css)
    } else {
      res.setHeader("Content-Type", "text/html")
      res.end(
        '<!doctype html><html lang="en"><head><title>Repair fixture</title><link rel="stylesheet" href="/Panel.css"></head><body><main id="fixture"></main><script type="module" src="/Panel.js"></script></body></html>'
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`
  )
  const correct = page.getByRole("button", { name: "Correct and redrive", exact: true })
  await correct.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("button", { name: "Submit repair" })).toBeDisabled()
  await page
    .getByLabel("Reason (synthetic context only)")
    .fill("Repair synthetic behavior")
  await page.getByLabel("Investigation", { exact: true }).selectOption("KnownFailure")
  await page.getByLabel("I confirm possible duplicate effects").check()
  const editor = page.getByLabel("Validated synthetic replacement JSON")
  const payload = JSON.parse(await editor.inputValue())
  await editor.fill(
    JSON.stringify({ ...payload, tenant: "demo-tenant-b", behavior: "success" })
  )
  await expect(page.getByRole("button", { name: "Submit repair" })).toBeDisabled()
  await editor.fill(JSON.stringify({ ...payload, behavior: "success" }))
  await expect(page.getByText("Changed: /behavior", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Submit repair" })).toBeEnabled()
  await page.addScriptTag({
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/axe.js`
  })
  const violations = await page.evaluate(
    async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
        })
      ).violations
  )
  assert.deepEqual(
    violations.map((v) => ({ id: v.id, impact: v.impact })),
    []
  )
  await page.screenshot({ path: resolve(output, "repair-panel.png"), fullPage: true })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(correct).toBeFocused()
  checks.push(
    "strict validation/diff/reason/investigation/duplicate guard; Escape focus restoration; zero WCAG A/AA violations"
  )
  await correct.click()
  await page
    .getByLabel("Reason (synthetic context only)")
    .fill("Repair synthetic behavior")
  await page.getByLabel("Investigation", { exact: true }).selectOption("KnownFailure")
  await page.getByLabel("I confirm possible duplicate effects").check()
  await editor.fill(JSON.stringify({ ...payload, behavior: "success" }))
  await page.getByRole("button", { name: "Submit repair" }).click()
  const submitted = await page.evaluate(() => window.repairFixture.commands)
  assert.equal(submitted.length, 1)
  assert(submitted[0])
  assert.equal(submitted[0].action, "corrected-redrive")
  assert(submitted[0].action === "corrected-redrive")
  assert.equal(submitted[0].expectedLifecycleVersion, 2)
  assert.equal((submitted[0].payload as { behavior: string }).behavior, "success")
  await expect(page.getByRole("button", { name: "Check repair receipt" })).toBeVisible()
  await page.getByRole("button", { name: "Check repair receipt" }).click()
  assert.equal(await page.evaluate(() => window.repairFixture.receipts()), 1)
  assert.equal(
    await page.evaluate(() => window.repairFixture.commands[0]!.requestId),
    submitted[0].requestId
  )
  checks.push(
    "immutable pending request/receipt identity; no resubmission control while outcome unknown"
  )
  await page.evaluate(() => window.repairFixture.reset())
  await correct.click()
  await page.evaluate(() => window.repairFixture.revise())
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.evaluate(() => window.repairFixture.readonly())
  await expect(
    page.getByRole("region", { name: "Repair and resolution", exact: true })
  ).toHaveCount(0)
  await expect(correct).toHaveCount(0)
  checks.push(
    "stale lifecycle/version closes editor; read-only removes mutation controls"
  )
  await page.evaluate(() => {
    window.repairFixture.reset()
    window.repairFixture.encrypted()
  })
  await expect(correct).toHaveCount(0)
  await page.evaluate(() => {
    window.repairFixture.reset()
    window.repairFixture.uncertain()
  })
  await page.getByRole("button", { name: "Close problem", exact: true }).click()
  await page
    .getByLabel("Reason (synthetic context only)")
    .fill("Unknown effects reviewed")
  await expect(page.getByRole("button", { name: "Record resolution" })).toBeDisabled()
  await page.getByLabel("I acknowledge unresolved external effects").check()
  await expect(page.getByRole("button", { name: "Record resolution" })).toBeEnabled()
  await page.getByRole("button", { name: "Record resolution" }).click()
  assert.equal(
    await page.evaluate(
      () =>
        (window.repairFixture.commands[0] as JobResolutionCommand).confirmUnknownOutcome
    ),
    true
  )
  checks.push(
    "unsupported encrypted correction absent; unknown manual close requires explicit confirmation"
  )
  await page.evaluate(() => window.repairFixture.reset())
  await page.setViewportSize({ width: 360, height: 700 })
  await correct.click()
  const box = await page.getByRole("dialog").boundingBox()
  assert.ok(box && box.x >= 0 && box.x + box.width <= 361)
  await page.getByRole("button", { name: "Keep current problem", exact: true }).click()
  await expect(correct).toBeFocused()
  assert.deepEqual(errors, [])
  assert.equal(await page.locator("style").count(), 0)
  checks.push(
    "narrow viewport access; Base UI close focus; compiled StyleX without runtime injection"
  )
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        scope: "isolated synthetic component; NOT integrated PG/workerd",
        temporaryContracts: false,
        inputs,

        scriptSha256: hash(script),
        cssSha256: hash(css),
        checks,
        errors
      },
      null,
      2
    ) + "\n"
  )
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: checks.length,
      scope: "isolated component",
      temporaryContracts: false
    })
  )
} finally {
  if (browser) {
    await browser.close()
  }
  if (server) {
    await new Promise<void>((done, reject) =>
      server!.close((error) => (error ? reject(error) : done()))
    )
  }
}
