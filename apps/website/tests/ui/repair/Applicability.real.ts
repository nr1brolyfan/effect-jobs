import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { Pool } from "pg"
// Bounded real PostgreSQL/workerd/browser qualification. No lifecycle SQL writes.
const { createLocal, readQualificationConfiguration } = (await import(
  new URL("../../../../playground-worker/tests/integration/Local.ts", import.meta.url)
    .href
)) as typeof import("../../../../playground-worker/tests/integration/Local.js")
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test")
const output = ".multica/task/real"
mkdirSync(output, { recursive: true })
const cfg = readQualificationConfiguration()
const { migrations } = await import(
  process.env.PLAYGROUND_MIGRATIONS_MODULE ??
    resolve(".multica/integration/Migrations.mjs")
)
const pool = new Pool({
  host: "127.0.0.1",
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const checks: unknown[] = [],
  errors: string[] = []
const sql = async (text: string, values: unknown[] = []) =>
  (
    await pool.query<{
      id: string
      state: string
      kind: string
      lifecycle_version: number
      server_version: string
    }>(text, values)
  ).rows
const until = async (check: () => Promise<boolean>, label: string, ms = 30000) => {
  const deadline = Date.now() + ms
  while (!(await check())) {
    assert(Date.now() < deadline, label)
    await new Promise((done) => setTimeout(done, 200))
  }
}
let local: Awaited<ReturnType<typeof createLocal>> | undefined,
  browser: import("@playwright/test").Browser | undefined,
  page: import("@playwright/test").Page | undefined
try {
  const version = (await sql("SHOW server_version"))[0]!.server_version
  assert.match(version, /^16\.15/)
  await sql(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of migrations(cfg.schema)) {
    await sql(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false, localPrivate: true })
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"]
  })
  const activePage = await context.newPage()
  page = activePage
  activePage.setDefaultTimeout(8000)
  activePage.on("pageerror", (e) => errors.push(e.message))
  await activePage.goto(local.origin + "/jobs")
  await expect(
    activePage.getByRole("heading", { name: "Background Jobs", exact: true })
  ).toBeVisible()
  const cookies = await context.cookies()
  const csrf = cookies.find((c) => c.name.startsWith("playground-local-csrf-"))!.value
  const headers = {
    Origin: local.origin,
    "Content-Type": "application/json",
    "X-Playground-CSRF": csrf
  }
  const post = async (path: string, data?: unknown) => {
    const response = await context.request.post(local!.origin + path, { headers, data })
    assert.equal(response.status(), 200, path)
    return response.json()
  }
  const sandbox = await post("/api/sandbox")
  const run = async (scenario: string, count = 6): Promise<string[]> => {
    const result = await post("/api/scenarios", {
      sandbox: sandbox.ref,
      requestId: crypto.randomUUID(),
      scenario,
      count
    })
    assert.equal(result._tag, "Committed")
    return result.jobIds
  }
  const pending = await run("delayed-success")
  const success = await run("success")
  const retry = await run("retry-then-success")
  const dead = await run("terminal-failure")
  const isolated = await run("isolated")
  const queryJobs = async (ids: readonly string[]) =>
    sql(
      `SELECT id,state,kind,lifecycle_version FROM "${cfg.schema}".jobs WHERE id=ANY($1::text[])`,
      [ids]
    )
  for (const [ids, state] of [
    [success, "Completed"],
    [retry, "RetryScheduled"],
    [dead, "Dead"],
    [isolated, "Isolated"]
  ] as const) {
    await until(
      async () => (await queryJobs(ids)).every((r) => r.state === state),
      `real ${state}`
    )
  }
  const chosen: Record<string, string> = {
    Pending: pending[0]!,
    Completed: success[0]!,
    RetryScheduled: retry[0]!,
    Dead: (await queryJobs(dead)).find(
      (r) => r.kind === "playground.synthetic-document-export"
    )!.id,
    Isolated: isolated[0]!
  }
  // A real UI cancellation supplies the Cancelled fixture and exercises live groups.
  const open = async (id: string, surface: string, width: number) => {
    await activePage.setViewportSize({ width, height: 1000 })
    if (
      await activePage.getByRole("heading", { name: "Job details", exact: true }).count()
    ) {
      await activePage.getByRole("button", { name: "Back to jobs", exact: true }).click()
    } else if (
      await activePage
        .getByRole("button", { name: "Close job details", exact: true })
        .count()
    ) {
      await activePage
        .getByRole("button", { name: "Close job details", exact: true })
        .click()
    }
    const state = (await queryJobs([id]))[0]!.state
    await activePage
      .getByRole("tab", {
        name: new RegExp(`^${state === "RetryScheduled" ? "Retry scheduled" : state}\\b`)
      })
      .click()
    await activePage.getByRole("combobox", { name: "Rows per page" }).selectOption("50")
    await activePage.getByRole("button", { name: id, exact: true }).click()
    await expect(
      activePage.getByRole("heading", { name: "Quick job details", exact: true })
    ).toBeVisible()
    if (surface === "full") {
      await activePage
        .getByRole("button", { name: "Open full details", exact: true })
        .click()
      await expect(
        activePage.getByRole("heading", { name: "Job details", exact: true })
      ).toBeVisible()
    }
  }
  await open(pending[1]!, "drawer", 1280)
  await activePage.getByRole("button", { name: "Cancel job", exact: true }).click()
  await activePage.getByRole("button", { name: "Confirm action", exact: true }).click()
  await until(
    async () => (await queryJobs([pending[1]!]))[0]!.state === "Cancelled",
    "cancel persisted"
  )
  await expect(activePage.getByRole("region", { name: "Job operators" })).toHaveCount(0)
  await expect(
    activePage.getByRole("region", { name: "Repair and resolution", exact: true })
  ).toHaveCount(0)
  chosen.Cancelled = pending[1]!
  checks.push("Pending -> Cancelled through confirmed UI; live action groups disappear")
  for (const width of [1280, 390]) {
    for (const [state, id] of Object.entries(chosen)) {
      for (const surface of ["drawer", "full"]) {
        await open(id, surface, width)
        const payload = activePage.getByRole("region", {
          name: "Job payload",
          exact: true
        })
        await expect(payload.locator("dt")).toHaveCount(0)
        await expect(payload.getByRole("status")).toHaveCSS("position", "absolute")
        const expected =
          state === "Pending"
            ? ["Cancel job"]
            : state === "RetryScheduled"
              ? ["Retry now", "Cancel job"]
              : state === "Dead" || state === "Isolated"
                ? [
                    "Redrive as new job",
                    "Correct and redrive",
                    "Reconcile applied effect",
                    "Close problem"
                  ]
                : []
        for (const label of [
          "Retry now",
          "Cancel job",
          "Redrive as new job",
          "Correct and redrive",
          "Reconcile applied effect",
          "Close problem"
        ]) {
          await expect(
            activePage.getByRole("button", { name: label, exact: true })
          ).toHaveCount(expected.includes(label) ? 1 : 0)
        }
        if (state === "Dead") {
          await expect(
            activePage.getByRole("button", { name: "Correct and redrive", exact: true })
          ).toBeDisabled()
          await expect(
            activePage.getByText("Unlock the payload to correct and redrive.", {
              exact: true
            })
          ).toBeVisible()
        }
        await activePage.screenshot({
          path: `${output}/${state}-${surface}-${width}.png`,
          fullPage: surface === "full"
        })
        checks.push({ state, surface, width, expected })
      }
    }
  }
  await open(chosen.Dead!, "drawer", 390)
  await activePage.getByLabel("Demo unlock code", { exact: true }).fill("wrong")
  await activePage.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(
    activePage.getByText("Locked · authentication failed. Demo code: 123.", {
      exact: true
    })
  ).toBeVisible()
  await activePage.screenshot({ path: `${output}/wrong-code.png`, fullPage: false })
  await activePage.getByLabel("Demo unlock code", { exact: true }).fill("123")
  await activePage.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(activePage.getByLabel("Readable payload", { exact: true })).toBeVisible()
  await expect(
    activePage.getByRole("button", { name: "Correct and redrive", exact: true })
  ).toBeEnabled()
  await activePage.getByRole("button", { name: "Copy payload", exact: true }).click()
  assert.equal(
    await activePage.evaluate(() => navigator.clipboard.readText()),
    await activePage.getByLabel("Readable payload", { exact: true }).textContent()
  )
  await activePage
    .getByRole("button", { name: "Correct and redrive", exact: true })
    .click()
  const editor = activePage.getByLabel("Validated synthetic replacement JSON")
  const replacement = JSON.parse(await editor.inputValue())
  await editor.fill(
    JSON.stringify({
      ...replacement,
      behavior: "success",
      document: { ...replacement.document, note: "Corrected real synthetic fixture" }
    })
  )
  await activePage
    .getByLabel("Reason (synthetic context only)")
    .fill("Correct synthetic failure")
  await activePage
    .getByLabel("Investigation", { exact: true })
    .selectOption("KnownFailure")
  await activePage.getByLabel("I confirm possible duplicate effects").check()
  await activePage.screenshot({ path: `${output}/corrected-editor.png`, fullPage: false })
  await activePage.getByRole("button", { name: "Submit repair", exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(activePage.getByLabel("Readable payload", { exact: true })).toHaveCount(0)
  await until(
    async () =>
      (
        await sql(
          `SELECT j.state FROM "${cfg.schema}".jobs j WHERE j.original_source_job_id=$1`,
          [chosen.Dead!]
        )
      ).some((r) => r.state === "Completed"),
    "corrected successor completed"
  )
  await expect(
    activePage.getByRole("button", { name: "Correct and redrive", exact: true })
  ).toHaveCount(0)
  checks.push(
    "real encrypted payload: wrong code, unlock, clipboard equals displayed JSON, edit/seal/redrive, successor completion, source relock and live resolved groups"
  )
  await open(chosen.RetryScheduled!, "full", 1280)
  await activePage.getByRole("button", { name: "Retry now", exact: true }).click()
  await activePage.getByRole("button", { name: "Confirm action", exact: true }).click()
  await until(
    async () => (await queryJobs([chosen.RetryScheduled!]))[0]!.state === "Completed",
    "retry completion"
  )
  await expect(activePage.getByRole("region", { name: "Job operators" })).toHaveCount(0)
  checks.push("RetryScheduled -> Completed through confirmed UI; live controls disappear")
  await activePage.goto(local.origin + "/demo")
  await expect(
    activePage.getByRole("button", { name: "Create jobs", exact: true })
  ).toHaveCount(0)
  const row = activePage.locator("button[data-job-id]").first()
  await row.click()
  await expect(activePage.getByRole("region", { name: "Job operators" })).toHaveCount(0)
  await expect(
    activePage.getByRole("region", { name: "Repair and resolution", exact: true })
  ).toHaveCount(0)
  checks.push("real public demo omits private action groups")
  assert.deepEqual(errors, [])
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify({ result: "PASS", version, checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ result: "PASS", checks: checks.length, version }))
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true })
  console.log(
    JSON.stringify({
      headings: await page?.locator("h1,h2,h3,[role=status]").allTextContents(),
      url: page?.url()
    })
  )
  throw error
} finally {
  writeFileSync(`${output}/checkpoint.json`, JSON.stringify({ checks, errors }, null, 2))
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
  writeFileSync(
    `${output}/cleanup.json`,
    JSON.stringify({
      browserClosed: !browser?.isConnected(),
      miniflareDisposed: true,
      poolEnded: true
    })
  )
}
