// Finite isolated browser/StyleX qualification; no DB, preview or shared registrars.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"
import transformTypescript from "@babel/plugin-transform-typescript"
import transformReactJsx from "@babel/plugin-transform-react-jsx"

const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(".multica/payload-evidence/browser")
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve("apps/website/tests/ui/payload/.browser-"))
const paths = [
  "src/ui/Theme.stylex.ts",
  "src/ui/Primitives.stylex.ts",
  "src/ui/Primitives.tsx",
  "src/features/jobs/payload/JobPayloadPanel.tsx",
  "src/features/jobs/payload/JobPayloadPanel.stylex.ts",
  "src/features/jobs/payload/BrowserDocumentCrypto.ts",
  "tests/ui/payload/Render.tsx"
]
const hash = (value) => createHash("sha256").update(value).digest("hex")
const inputs = {},
  rules = [],
  checks = [],
  errors = [],
  requests = [],
  logs = []
let server, browser
try {
  for (const path of paths) {
    const source = await readFile(resolve("apps/website", path), "utf8")
    inputs[`apps/website/${path}`] = hash(source)
    const target = resolve(scratch, path.replace(/\.tsx?$/, ".js"))
    const transpiled = await transformAsync(source, {
      filename: path,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          transformTypescript,
          {
            isTSX: path.endsWith(".tsx"),
            allExtensions: true,
            onlyRemoveTypeImports: true
          }
        ],
        [transformReactJsx, { runtime: "automatic" }]
      ]
    })
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, transpiled.code)
  }
  for (const path of paths) {
    const filename = resolve(scratch, path.replace(/\.tsx?$/, ".js"))
    const compiled = await transformAsync(await readFile(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          stylexPlugin,
          {
            dev: false,
            runtimeInjection: false,
            treeshakeCompensation: true,
            unstable_moduleResolution: { type: "commonJS", rootDir: scratch }
          }
        ]
      ]
    })
    assert.doesNotMatch(compiled.code, /\bstylex\.(create|defineVars)\s*\(/)
    rules.push(...(compiled.metadata.stylex ?? []))
    await writeFile(filename, compiled.code)
  }
  const fixturePath = resolve(
    "packages/playground-contracts/src/SyntheticCryptoFixture.ts"
  )
  inputs["packages/playground-contracts/src/SyntheticCryptoFixture.ts"] = hash(
    await readFile(fixturePath)
  )
  const built = await Bun.build({
    entrypoints: [resolve(scratch, "tests/ui/payload/Render.js")],
    target: "browser",
    minify: true,
    outdir: output,
    naming: "Payload.js",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    // Test-only missing export adapter. Production registration is deliberately deferred.
    plugins: [
      {
        name: "isolated-fixture-export",
        setup(build) {
          build.onResolve(
            { filter: /^@effect-jobs\/playground-contracts\/SyntheticCryptoFixture$/ },
            () => ({ path: fixturePath })
          )
        }
      }
    ]
  })
  assert.equal(built.success, true, JSON.stringify(built.logs))
  const css =
    (await readFile("apps/website/src/styles/Jobs.css", "utf8")) +
    "\n" +
    stylexPlugin.processStylexRules(rules)
  await writeFile(resolve(output, "Payload.css"), css)
  const script = await readFile(resolve(output, "Payload.js"))
  const axe = await readFile(require.resolve("axe-core/axe.min.js"))
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
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
      value: (key, value) => window.persisted.push({ key, value })
    })
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text) => window.copied.push(text) }
    })
    document.addEventListener("securitypolicyviolation", (event) =>
      window.csp.push(event.violatedDirective)
    )
    const original = crypto.subtle.decrypt.bind(crypto.subtle)
    window.holdDecrypt = () => {
      window.decryptStarted = false
      window.decryptFinished = new Promise((done) => {
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
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const plain = page.getByLabel("Locally decrypted document")
  const unlock = async () => {
    await page.getByLabel("Demo unlock code").fill("123")
    await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
    await expect(plain).toContainText("payload-browser-secret-synthetic")
  }
  const locked = async () => {
    await expect(plain).toHaveCount(0)
  }
  await expect(page.getByText(/Synthetic demo data only/)).toBeVisible()
  await expect(page.getByText(/Shape validation does not verify/)).toBeVisible()
  await expect(page.getByText("Unavailable: not-stored.")).toBeVisible()
  await page.getByLabel("Demo unlock code").fill("321")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("authentication failed")
  await locked()
  await unlock()
  await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
  await expect(page.getByRole("status")).toContainText("HMAC verified locally")
  await page.getByText("Show encoded payload", { exact: true }).click()
  await page.getByRole("button", { name: "Copy encoded payload" }).click()
  const copied = await page.evaluate(() => window.copied)
  assert.equal(copied.length, 1)
  assert.ok(JSON.parse(copied[0]).document.ciphertext.length > 16)
  assert.ok(!copied[0].includes("payload-browser-secret-synthetic"))
  assert.equal(
    await plain.evaluate((node) =>
      node.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }))
    ),
    false
  )
  checks.push(
    "real AES-GCM/HMAC unlock; wrong code locked; input cleared; encoded-only clipboard and decrypted copy blocked; shape/auth/result distinction"
  )
  for (const action of ["Relock", "Change mode", "Change generation", "Change job"]) {
    if ((await plain.count()) === 0) {
      await unlock()
    }
    await page.getByRole("button", { name: action, exact: true }).click()
    await locked()
    await expect(page.getByLabel("Demo unlock code")).toHaveValue("")
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
  await expect(page.getByRole("button", { name: "Copy encoded payload" })).toHaveCount(0)
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
  const hex = (start) =>
    Array.from({ length: 32 }, (_, i) => (i + start).toString(16).padStart(2, "0")).join(
      ""
    )
  await enc.fill(hex(1))
  await fp.fill(hex(101))
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(plain).toContainText("payload-browser-secret-synthetic")
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await page.getByRole("button", { name: "Plain fixture" }).click()
  await expect(page.getByLabel("Encoded payload")).toContainText(
    "<script>never-execute</script>"
  )
  assert.equal(await page.locator("script").count(), 1)
  await page.getByRole("button", { name: "Copy encoded payload" }).click()
  assert.equal(JSON.parse(await page.evaluate(() => window.copied.at(-1))).value, 42)
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
  await page.addScriptTag({ url: "/axe.js" })
  const audit = async () =>
    assert.deepEqual(
      await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
          })
        ).violations.map(({ id }) => id)
      ),
      []
    )
  await audit()
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
    await new Promise((done) => server.close(done))
  }
  await rm(scratch, { recursive: true, force: true })
}
