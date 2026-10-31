// Browser FFI against the production bundle with controlled scoped HTTP/WS data.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import * as F from "../../../../packages/playground-contracts/dist/Fixtures.js"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const { WebSocketServer } = createRequire(require.resolve("miniflare"))("ws")
const output = process.env.CREATE_JOBS_OUTPUT_DIRECTORY ?? ".multica/create-jobs/browser"
const buildDirectory = process.env.CREATE_JOBS_BUILD_DIRECTORY ?? "apps/website/dist"
mkdirSync(output, { recursive: true })
const script = readFileSync(resolve(buildDirectory, "Client.js"))
const css = readFileSync(resolve(buildDirectory, "Jobs.css"))
const sandbox = {
  ...F.sandbox,
  expiresAt: Date.now() + 3600000,
  capabilities: Object.fromEntries(
    Object.keys(F.sandbox.capabilities).map((k) => [k, true])
  )
}
const states = [
  "Completed",
  "Active",
  "Pending",
  "RetryScheduled",
  "Dead",
  "Isolated",
  "Cancelled"
]
const jobs = Array.from({ length: 77 }, (_, n) => ({
  ...F.page.items[0],
  jobId: `synthetic-job-${String(n).padStart(3, "0")}`,
  state: states[n % 7],
  completedAt: ["Completed", "Dead", "Cancelled"].includes(states[n % 7])
    ? F.page.items[0].completedAt
    : null,
  catalog: { ...F.page.items[0].catalog, kind: n % 2 ? "test.odd" : "test.even" },
  availableAt: Date.now() - 60000
}))
const stats = () => ({
  ...F.page.stats,
  total: jobs.length,
  ...Object.fromEntries(states.map((s) => [s, jobs.filter((j) => j.state === s).length]))
})
const resolutions = ["Open", "InProgress", "Resolved"]
const mutations = []
let mutationFail = false
let delay = 0,
  fail = false
const requests = [],
  errors = [],
  checks = []
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname === "/axe.js") {
    res.setHeader("Content-Type", "text/javascript")
    return res.end(readFileSync(require.resolve("axe-core/axe.min.js")))
  }
  if (url.pathname === "/Client.js" || url.pathname === "/Jobs.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("js") ? "text/javascript" : "text/css"
    )
    return res.end(url.pathname.endsWith("js") ? script : css)
  }
  if (
    url.pathname === "/demo" ||
    url.pathname === "/jobs" ||
    url.pathname.startsWith("/jobs/")
  ) {
    res.setHeader("Content-Type", "text/html")
    return res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard qualification</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  }
  res.setHeader("Content-Type", "application/json")
  if (
    url.pathname === "/api/demo" ||
    url.pathname === "/api/sandbox" ||
    url.pathname === "/api/sandbox/issue"
  ) {
    return res.end(JSON.stringify(sandbox))
  }
  if (
    url.pathname === "/api/jobs" ||
    url.pathname === "/api/jobs/problems" ||
    url.pathname === "/api/demo/jobs"
  ) {
    const q = Object.fromEntries(url.searchParams)
    requests.push(q)
    const filtered = jobs.filter(
      (j) =>
        (!q.state || j.state === q.state) &&
        (!q.kind || j.catalog.kind === q.kind) &&
        (!q.resolution || resolutions[Number(j.jobId.slice(-3)) % 3] === q.resolution) &&
        (!q.needsAttention || Number(j.jobId.slice(-3)) % 3 !== 2)
    )
    const offset = Number(q.cursor ?? 0),
      limit = Number(q.limit)
    const data = {
      ...F.page,
      sandbox: sandbox.ref,
      stats: stats(),
      filteredTotal: filtered.length,
      items: filtered.slice(offset, offset + limit).map((j) =>
        url.pathname.endsWith("/problems")
          ? {
              problem: {
                rootJobId: j.jobId,
                state: resolutions[Number(j.jobId.slice(-3)) % 3],
                version: 0,
                activeSuccessorJobId: null,
                outcomeKnowledge: "KnownFailure",
                resolution: null,
                updatedAt: j.updatedAt
              },
              representative: j
            }
          : j
      ),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null
    }
    const failed = fail
    await new Promise((r) => setTimeout(r, delay))
    return res
      .writeHead(failed ? 503 : 200)
      .end(JSON.stringify(failed ? { code: "unavailable" } : data))
  }
  if (
    url.pathname === "/api/scenarios" ||
    url.pathname === "/api/scenarios/receipt" ||
    url.pathname === "/api/sandbox/reset"
  ) {
    let body = ""
    for await (const chunk of req) {
      body += chunk
    }
    const input = JSON.parse(body)
    mutations.push({ path: url.pathname, input })
    await new Promise((r) => setTimeout(r, 200))
    if (mutationFail && url.pathname === "/api/scenarios") {
      return res.writeHead(503).end('{"code":"unavailable"}')
    }
    if (url.pathname === "/api/sandbox/reset") {
      const previous = { ...sandbox.ref }
      sandbox.ref = { ...previous, generation: previous.generation + 1 }
      return res.end(
        JSON.stringify({
          _tag: "Committed",
          previous,
          current: sandbox.ref,
          requestId: input.requestId
        })
      )
    }
    const result = {
      _tag: "Committed",
      sandbox: input.sandbox,
      requestId: input.requestId,
      jobIds: ["synthetic-created"]
    }
    return res.end(JSON.stringify(result))
  }
  if (url.pathname === "/api/jobs/detail") {
    return res.end(
      JSON.stringify({
        ...F.detail,
        sandbox: sandbox.ref,
        job: jobs.find((j) => j.jobId === url.searchParams.get("jobId"))
      })
    )
  }
  res.writeHead(404).end('{"code":"not-found"}')
})
const signals = new WebSocketServer({ server })
let sequence = 1
const signal = (kind) => {
  for (const socket of signals.clients) {
    socket.send(
      JSON.stringify({
        kind,
        sandbox: sandbox.ref,
        reason: "reconcile",
        sequence: sequence++
      })
    )
  }
}
signals.on("connection", () => signal("ready"))
await new Promise((r) => server.listen(0, "127.0.0.1", r))

let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(6000)
  page.on("pageerror", (e) => errors.push(e.message))
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.goto(origin + "/jobs")
  const result = page.locator(".results-count")
  const resolution = page.getByLabel("Resolution", { exact: true })
  await expect(result).toHaveText("77 results")
  await expect(page.locator(".panel-heading select")).toHaveCount(1)
  await expect(
    page.locator("details.scenario-panel, section[aria-label='Problem resolution']")
  ).toHaveCount(0)
  await expect(page.getByLabel("Fake provider behavior")).toHaveCount(0)
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.locator(".job-id").first()).toHaveText("synthetic-job-020")
  for (const [value, total] of [
    ["attention", 52],
    ["Open", 26],
    ["InProgress", 26],
    ["Resolved", 25],
    ["all", 77]
  ]) {
    await resolution.selectOption(value)
    await expect(result).toHaveText(`${total} results`)
    await expect(
      page.getByRole("button", { name: "Page 1", exact: true })
    ).toHaveAttribute("aria-current", "page")
  }
  await page.getByRole("tab", { name: /^Dead/ }).click()
  await expect(result).toHaveText("11 results")
  await resolution.selectOption("Open")
  await expect(result).toHaveText("3 results")
  assert.equal(requests.at(-1).state, "Dead")
  assert.equal(requests.at(-1).resolution, "Open")
  await expect(page.getByRole("tab", { name: /^All jobs/ })).toContainText("77")
  await page.locator(".job-id").first().click()
  await page.getByRole("button", { name: "Open full details", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Job details", exact: true })
  ).toBeVisible()
  await page.goBack()
  await expect(result).toHaveText("3 results")
  await expect(resolution).toHaveValue("Open")
  await expect(page.getByRole("tab", { name: /^Dead/ })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  if (
    await page.getByRole("button", { name: "Close job details", exact: true }).count()
  ) {
    await page.getByRole("button", { name: "Close job details", exact: true }).click()
  }
  const readCount = requests.length
  signal("invalidate")
  await expect.poll(() => requests.length).toBeGreaterThan(readCount)
  await expect(resolution).toHaveValue("Open")
  await expect(result).toHaveText("3 results")
  await resolution.selectOption("all")
  await expect(result).toHaveText("11 results")
  checks.push(
    "resolution options, cursor reset, combined status, global totals, details/Back and live preservation, clear"
  )
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${output}/${width}-dashboard.png`, fullPage: true })
    const create = page.getByRole("button", { name: "Create jobs", exact: true })
    await create.click()
    const dialog = page.getByRole("dialog", { name: "Create jobs", exact: true })
    const scenario = dialog.getByLabel("Fake provider behavior")
    await expect(scenario).toBeFocused()
    const values = await scenario
      .locator("option")
      .evaluateAll((ns) => ns.map((n) => n.value))
    assert.deepEqual(values, [
      "success",
      "delayed-success",
      "isolated",
      "retry-then-success",
      "terminal-failure",
      "unknown-outcome",
      "deduplication"
    ])
    const count = dialog.getByLabel("Jobs (1–10)")
    const submit = dialog.getByRole("button", { name: "Run scenario", exact: true })
    for (const invalid of ["0", "11", "1.5", ""]) {
      await count.fill(invalid)
      await expect(submit).toBeDisabled()
    }
    await count.fill("2")
    await scenario.selectOption("delayed-success")
    const before = mutations.length
    await submit.evaluate((n) => {
      n.click()
      n.click()
      n.click()
    })
    await expect(
      dialog.getByRole("button", { name: "Creating…", exact: true })
    ).toBeDisabled()
    await expect(dialog.getByRole("status")).toContainText("Enqueue acknowledged for 1")
    assert.equal(mutations.length, before + 1)
    assert.equal(mutations.at(-1).input.count, 2)
    assert.equal(mutations.at(-1).input.scenario, "delayed-success")
    await dialog.locator("summary").click()
    let confirmed = false
    page.once("dialog", async (d) => {
      confirmed = /Running jobs are not cancelled/.test(d.message())
      await d.dismiss()
    })
    await dialog.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
    assert(confirmed)
    assert.equal(mutations.length, before + 1)
    await page.addScriptTag({ url: "/axe.js" })
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
          })
        ).violations
    )
    assert.deepEqual(violations, [])
    await page.screenshot({ path: `${output}/${width}-dialog.png`, fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab")
      await expect
        .poll(() => dialog.evaluate((n) => n.contains(document.activeElement)))
        .toBe(true)
    }
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(create).toBeFocused()
    await create.click()
    await expect(page.getByLabel("Jobs (1–10)")).toHaveValue("1")
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(create).toBeFocused()
  }
  checks.push(
    "desktop1440/mobile390 dialog, focus trap/Escape/close/restore, all scenarios, input bounds, repeated clicks single mutation, reset cancellation, close/reopen"
  )
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  mutationFail = true
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Command not confirmed" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeDisabled()
  mutationFail = false
  await page
    .getByRole("button", { name: "Check exact request receipt", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeEnabled()
  await page.getByLabel("Jobs (1–10)").fill("7")
  await page.locator("summary").click()
  page.once("dialog", (d) => d.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await expect(page.getByLabel("Jobs (1–10)")).toHaveValue("1")
  await expect(page.getByLabel("Fake provider behavior")).toHaveValue("success")
  await expect
    .poll(() =>
      page
        .getByRole("dialog", { name: "Create jobs", exact: true })
        .evaluate((n) => n.contains(document.activeElement))
    )
    .toBe(true)
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await expect.poll(() => mutations.at(-1).input.sandbox.generation).toBe(2)
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeEnabled()
  checks.push(
    "API error blocks replay, exact receipt recovery, successful reset clears old generation controls, next mutation uses generation2"
  )
  await page.keyboard.press("Escape")
  sandbox.capacity = { mode: "bounded", retainedJobs: 99, admittedCommands: 199 }
  await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await expect(page.locator(".results-count")).toHaveText("11 results")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await page.getByLabel("Jobs (1–10)").fill("2")
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeDisabled()
  await page.getByLabel("Jobs (1–10)").fill("1")
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeEnabled()
  await page.locator("summary").click()
  await expect(
    page.getByRole("button", { name: "Reset my sandbox", exact: true })
  ).toBeDisabled()
  await page.keyboard.press("Escape")
  sandbox.capabilities.runScenario = false
  await page.getByRole("button", { name: "Refresh reads", exact: true }).click()
  await expect(page.locator(".results-count")).toHaveText("11 results")
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeDisabled()
  checks.push(
    "retained-job capacity, command capacity/reset bound and revoked create capability"
  )
  await page.goto(origin + "/demo")
  await expect(page.locator(".job-list tr")).toHaveCount(20)
  await expect(
    page.getByRole("button", { name: "Create jobs", exact: true })
  ).toHaveCount(0)
  await expect(page.getByLabel("Fake provider behavior")).toHaveCount(0)
  await expect(page.getByLabel("Resolution", { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  checks.push("public demo read only")
  writeFileSync(
    `${output}/receipt.json`,
    JSON.stringify(
      {
        result: "PASS",
        checks,
        requests,
        mutations,
        errors,
        browser: browser.version(),
        hashes: {
          script: createHash("sha256").update(script).digest("hex"),
          css: createHash("sha256").update(css).digest("hex")
        }
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ result: "PASS", checks }))
} finally {
  await browser?.close()
  for (const socket of signals.clients) {
    socket.terminate()
  }
  await new Promise((r) => signals.close(r))
  await new Promise((r) => server.close(r))
}
