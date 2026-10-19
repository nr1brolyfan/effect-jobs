// Finite browser/build FFI. Synthetic component fixture; no PG/network service.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises"
import { resolve, dirname, relative } from "node:path"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { transformAsync } from "@babel/core"
import transformTypescript from "@babel/plugin-transform-typescript"
import transformReactJsx from "@babel/plugin-transform-react-jsx"
import stylexPlugin from "@stylexjs/babel-plugin"

const repository = resolve(".")
const require = createRequire(resolve("apps/playground-worker/package.json"))
const websiteRequire = createRequire(resolve("apps/website/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(".toolchain/repairs/browser")
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(resolve(".toolchain/repairs/browser-build-"))
const sources = [
  "apps/website/src/ui/Theme.stylex.ts",
  "apps/website/src/ui/Primitives.stylex.ts",
  "apps/website/src/ui/Primitives.tsx",
  "apps/website/src/features/jobs/repair/JobRepairPanel.stylex.ts",
  "apps/website/src/features/jobs/repair/JobRepairPanel.tsx",
  "apps/website/src/features/jobs/repair/PayloadDiff.ts",
  "apps/website/tests/ui/repair/Panel.render.tsx"
]
const inputs = {},
  rules = [],
  checks = [],
  errors = []
const hash = (data) => createHash("sha256").update(data).digest("hex")
let browser, server
const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
try {
  for (const path of sources) {
    const text = await readFile(path, "utf8")
    inputs[path] = hash(text)
    const target = resolve(scratch, path.replace(/\.tsx?$/u, ".js"))
    await mkdir(dirname(target), { recursive: true })
    const result = await transformAsync(text, {
      filename: path,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          transformTypescript,
          {
            isTSX: path.endsWith("tsx"),
            allExtensions: true,
            onlyRemoveTypeImports: true
          }
        ],
        [transformReactJsx, { runtime: "automatic" }]
      ]
    })
    assert.ok(result?.code)
    await writeFile(target, result.code)
  }
  for (const path of sources) {
    const target = resolve(scratch, path.replace(/\.tsx?$/u, ".js"))
    const result = await transformAsync(await readFile(target, "utf8"), {
      filename: target,
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
    assert.ok(result?.code)
    rules.push(...(result.metadata.stylex ?? []))
    await writeFile(target, result.code)
  }
  const external = process.env.REPAIR_CONTRACT_DIRECTORY
    ? resolve(process.env.REPAIR_CONTRACT_DIRECTORY)
    : null
  if (external) {
    for (const name of ["Jobs", "Repairs", "Services"]) {
      inputs[`temporary-contract/${name}`] = hash(
        await readFile(resolve(external, `${name}.ts`))
      )
    }
  }
  const built = await Bun.build({
    entrypoints: [resolve(scratch, "apps/website/tests/ui/repair/Panel.render.js")],
    target: "browser",
    minify: true,
    outdir: output,
    naming: "Panel.js",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      {
        name: "repair-fixture-resolution",
        setup(build) {
          build.onResolve({ filter: /.*/u }, async (args) => {
            if (
              external &&
              /^@effect-jobs\/playground-contracts\/(Jobs|Repairs|Services)$/u.test(
                args.path
              )
            ) {
              return { path: resolve(external, `${args.path.split("/").at(-1)}.ts`) }
            }
            if (args.path.startsWith("@effect-jobs/playground-contracts/")) {
              return {
                path: resolve(
                  repository,
                  "packages/playground-contracts/dist",
                  `${args.path.split("/").at(-1)}.js`
                )
              }
            }
            if (args.path.startsWith(".") && args.importer.startsWith(scratch)) {
              const target = resolve(dirname(args.importer), args.path)
              if (await exists(target)) {
                return { path: target }
              }
              const actual = resolve(repository, relative(scratch, target))
              for (const candidate of [
                actual,
                actual.replace(/\.js$/u, ".ts"),
                actual.replace(/\.js$/u, ".tsx")
              ]) {
                if (await exists(candidate)) {
                  return { path: candidate }
                }
              }
            }
            if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
              try {
                return { path: websiteRequire.resolve(args.path) }
              } catch {
                try {
                  return { path: require.resolve(args.path) }
                } catch {
                  return undefined
                }
              }
            }
            return undefined
          })
        }
      }
    ]
  })
  assert.equal(built.success, true, JSON.stringify(built.logs))
  const script = await readFile(resolve(output, "Panel.js"))
  const css =
    (await readFile("apps/website/src/styles/Jobs.css", "utf8")) +
    "\n" +
    stylexPlugin.processStylexRules(rules)
  await writeFile(resolve(output, "Panel.css"), css)
  const axe = await readFile(require.resolve("axe-core/axe.min.js"))
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  page.setDefaultTimeout(5000)
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
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
  await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/axe.js` })
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
  assert.equal(submitted[0].action, "corrected-redrive")
  assert.equal(submitted[0].expectedLifecycleVersion, 2)
  assert.equal(submitted[0].payload.behavior, "success")
  await expect(page.getByRole("button", { name: "Check repair receipt" })).toBeVisible()
  await page.getByRole("button", { name: "Check repair receipt" }).click()
  assert.equal(await page.evaluate(() => window.repairFixture.receipts()), 1)
  assert.equal(
    await page.evaluate(() => window.repairFixture.commands[0].requestId),
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
    await page.evaluate(() => window.repairFixture.commands[0].confirmUnknownOutcome),
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
        temporaryContracts: external !== null,
        inputs,
        rules: rules.length,
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
      temporaryContracts: external !== null
    })
  )
} finally {
  if (browser) {
    await browser.close()
  }
  if (server) {
    await new Promise((done) => server.close(done))
  }
  await rm(scratch, { recursive: true, force: true })
}
