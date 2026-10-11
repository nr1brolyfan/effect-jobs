// Real PG + local workerd + Chromium integration. Assertions inspect persisted facts.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "pg"
import { Effect } from "effect"
import { chromium } from "@playwright/test"
import { createLocal } from "./Local.mjs"
const root = resolve(import.meta.dirname, "../../../..")
const evidence = resolve(root, ".multica/integration")
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({
  host: "127.0.0.1",
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const schema = cfg.schema
const report = {
  at: new Date().toISOString(),
  checks: [],
  observations: {},
  hosted: "NotTested",
  runtime: process.version
}
const sql = async (text, values = []) => (await pool.query(text, values)).rows
const check = (name) => report.checks.push({ name, at: new Date().toISOString() })
const until = async (test, label, budget = 15000) => {
  const deadline = Date.now() + budget
  for (;;) {
    if (await test()) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(label)
    }
    await new Promise((done) => setTimeout(done, 250))
  }
}
let mf, browser, local
try {
  assert.match((await sql("SHOW server_version"))[0].server_version, /^16\.15/)
  await sql("CREATE EXTENSION pg_stat_statements")
  await sql(`CREATE SCHEMA "${schema}"`)
  for (const migration of migrations(schema)) {
    await sql(migration.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { instrument: true })
  mf = local.mf
  const dispatch = (path, options = {}) => mf.dispatchFetch(local.origin + path, options)
  const post = (path, cookie, token, body) =>
    dispatch(path, {
      method: "POST",
      headers: {
        Origin: local.origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie, "X-Playground-CSRF": token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const issue = async () => {
    const response = await post("/api/sandbox/issue")
    assert.equal(response.status, 200)
    const cookies = response.headers.getSetCookie()
    assert(
      cookies.some(
        (value) =>
          value.includes("HttpOnly") &&
          value.includes("Secure") &&
          value.includes("SameSite=Strict")
      )
    )
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ")
    const token = cookies
      .find((value) => value.startsWith("__Host-playground-csrf="))
      .split(";")[0]
      .split("=")[1]
    return { sandbox: await response.json(), cookie, token }
  }
  assert.equal(
    (
      await dispatch("/api/sandbox/issue", {
        method: "POST",
        headers: { Origin: "https://foreign.invalid", "Content-Type": "application/json" }
      })
    ).status,
    400
  )
  const a = await issue(),
    b = await issue()
  const run = async (who, id, scenario = "success", count = 6) => {
    const response = await post("/api/scenarios", who.cookie, who.token, {
      sandbox: who.sandbox.ref,
      requestId: id,
      scenario,
      count
    })
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result._tag, "Committed")
    return result
  }
  const describe = (who) => post("/api/sandbox", who.cookie, who.token)
  const query = (who, extra = "") =>
    `/api/jobs?sandboxId=${who.sandbox.ref.sandboxId}&generation=${who.sandbox.ref.generation}&limit=5${extra}`
  assert.equal((await post("/api/scenarios", a.cookie, "wrong", {})).status, 400)
  assert.equal((await dispatch(query(a), { headers: { Cookie: b.cookie } })).status, 404)
  const initial = await run(a, "http-atomic")
  const replay = await run(a, "http-atomic")
  assert.deepEqual(replay.jobIds, initial.jobIds)
  const receipt = await post("/api/scenarios/receipt", a.cookie, a.token, {
    sandbox: a.sandbox.ref,
    requestId: "http-atomic"
  })
  assert.deepEqual((await receipt.json()).jobIds, initial.jobIds)
  const counts = (
    await sql(
      `SELECT (SELECT count(*) FROM "${schema}".associations WHERE sandbox_id=$1) AS jobs,(SELECT count(*) FROM "${schema}".command_receipts WHERE sandbox_id=$1) AS receipts,(SELECT count(*) FROM "${schema}".command_admission WHERE sandbox_id=$1) AS admissions`,
      [a.sandbox.ref.sandboxId]
    )
  )[0]
  assert.deepEqual(Object.values(counts).map(Number), [6, 1, 1])
  check("actual HTTP guarded command / atomic jobs associations receipt / exact replay")
  const view = await describe(a)
  assert.equal(view.status, 200)
  await until(
    async () =>
      (
        await sql(
          `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Completed'`,
          [initial.jobIds]
        )
      )[0].n === 6,
    "four queues did not complete six real handlers"
  )
  check("four registered native DOs / automatic local alarms / six real handlers")
  const first = await (await dispatch(query(a), { headers: { Cookie: a.cookie } })).json()
  assert.equal(first.items.length, 5)
  assert(first.nextCursor)
  assert(
    !/ciphertext|fingerprint|payload|leaseToken|synthetic private export/.test(
      JSON.stringify(first)
    )
  )
  const second = await (
    await dispatch(query(a, `&cursor=${first.nextCursor}`), {
      headers: { Cookie: a.cookie }
    })
  ).json()
  assert.equal(second.items.length, 1)
  assert(
    !first.items.some((job) => second.items.some((other) => other.jobId === job.jobId))
  )
  const privateJob = (
    await sql(
      `SELECT id FROM "${schema}".jobs WHERE kind='playground.private-data-export' LIMIT 1`
    )
  )[0]
  const detail = await (
    await dispatch(
      `/api/jobs/detail?sandboxId=${a.sandbox.ref.sandboxId}&generation=1&jobId=${privateJob.id}`,
      { headers: { Cookie: a.cookie } }
    )
  ).json()
  assert.equal(detail.job.jobId, privateJob.id)
  assert(
    !/ciphertext|fingerprint|payload|synthetic private export/.test(
      JSON.stringify(detail)
    )
  )
  check(
    "real SELECT-only projection / keyset pages / private detail / no decrypt on list"
  )
  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors"]
  })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  let reads = 0,
    describes = 0,
    ws = 0,
    readyFrames = 0,
    changedFrames = 0
  page.on("request", (req) => {
    if (req.url().includes("/api/jobs?")) {
      reads++
    }
    if (req.url().endsWith("/api/sandbox")) {
      describes++
    }
  })
  page.on("websocket", (socket) => {
    ws++
    socket.on("framereceived", ({ payload }) => {
      try {
        const signal = JSON.parse(String(payload))
        if (signal.kind === "ready") {
          readyFrames++
        }
        if (signal.reason === "jobs-changed") {
          changedFrames++
        }
      } catch {
        /* Protocol rejects invalid data in the application. */
      }
    })
  })
  await page.goto(local.origin + "/jobs")
  await page.getByRole("heading", { name: "Durable work, visible." }).waitFor()
  await until(
    () => Promise.resolve(readyFrames > 0),
    "browser received no live ready frame",
    10000
  )
  await page.getByLabel("Jobs (1–10)").fill("6")
  await page.getByRole("button", { name: "Run scenario", exact: true }).click()
  await page.getByText(/Enqueue acknowledged for/).waitFor()
  await page.locator(".job-list button").first().waitFor()
  await until(
    async () =>
      (await page.locator(".job-list li p").allTextContents()).some((text) =>
        text.includes("Completed")
      ),
    "browser did not reconcile persisted completion",
    15000
  )
  await page.locator(".job-list button").first().click()
  await page.getByText("Retry delay", { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => document.cookie.includes("__Host-playground=")),
    false
  )
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Reset my sandbox" }).click()
  await page.getByText(/New sandbox generation/).waitFor({ timeout: 10000 })
  const readsBeforeDisconnect = reads
  await context.setOffline(true)
  await page.waitForTimeout(500)
  await context.setOffline(false)
  await until(
    () => Promise.resolve(reads > readsBeforeDisconnect),
    "browser did not reconcile after reconnect",
    10000
  )
  await until(() => Promise.resolve(ws >= 2), "reset did not reconnect live scope", 10000)
  const secondPage = await context.newPage()
  await secondPage.goto(local.origin + "/jobs")
  await secondPage.getByRole("heading", { name: "Durable work, visible." }).waitFor()
  await secondPage.close()
  report.observations.browser = {
    reads,
    describes,
    webSockets: ws,
    readyFrames,
    changedFrames,
    viewers: 2,
    chromium: browser.version(),
    reconnectRead: reads > readsBeforeDisconnect
  }
  assert(ws > 0)
  await until(
    () => Promise.resolve(readyFrames >= 2),
    "new scope did not deliver live ready",
    10000
  )
  await until(
    () => Promise.resolve(changedFrames > 0),
    "no post-commit live invalidation received",
    10000
  )
  await page.screenshot({ path: `${evidence}/browser.png`, fullPage: true })
  check("actual Chromium UI/read/command/detail/reset/live")
  await context.close()
  // Keep authorized viewers alive during retry and unknown recovery; heartbeat kicks every queue.
  let heartbeatError
  const heartbeat = setInterval(() => {
    void Promise.all([describe(a), describe(b)]).catch((error) => {
      heartbeatError = error.constructor.name
    })
  }, 5000)
  try {
    const retry = await run(a, "http-retry", "retry-then-success")
    await until(
      async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Completed' AND attempts_made=2`,
            [retry.jobIds]
          )
        )[0].n === 6,
      "retry did not persist then complete",
      20000
    )
    const dead = await run(b, "http-dead", "terminal-failure")
    await until(
      async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Dead'`,
            [dead.jobIds]
          )
        )[0].n === 6,
      "terminal scenario not persisted"
    )
    const unknown = await run(b, "http-unknown", "unknown-outcome")
    await until(
      async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Active'`,
            [unknown.jobIds]
          )
        )[0].n === 6,
      "unknown not Active"
    )
    await until(
      async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Completed' AND stalled_count=1`,
            [unknown.jobIds]
          )
        )[0].n === 6,
      "unknown recovery did not complete",
      110000
    )
    assert.equal(
      (
        await sql(
          `SELECT max(invocations) AS n FROM "${schema}".provider_ledger WHERE job_id=ANY($1)`,
          [unknown.jobIds]
        )
      )[0].n,
      2
    )
    assert.equal(heartbeatError, undefined)
    check(
      "integrated persisted retry/dead/unknown/lease recovery / idempotent provider ledger"
    )
  } finally {
    clearInterval(heartbeat)
  }
  const old = a.sandbox.ref
  const reset = await post("/api/sandbox/reset", a.cookie, a.token, {
    sandbox: old,
    requestId: "reset-http"
  })
  assert.equal(reset.status, 200)
  a.sandbox.ref = (await reset.json()).current
  assert.equal(
    (
      await post("/api/scenarios", a.cookie, a.token, {
        sandbox: old,
        requestId: "stale-http",
        scenario: "success",
        count: 1
      })
    ).status,
    409
  )
  const resetReceipt = await post("/api/sandbox/reset/receipt", a.cookie, a.token, {
    sandbox: old,
    requestId: "reset-http"
  })
  assert.equal(resetReceipt.status, 200)
  assert(
    (
      await sql(
        `SELECT count(*)::int AS n FROM "${schema}".associations WHERE sandbox_id=$1 AND generation=1`,
        [old.sandboxId]
      )
    )[0].n >= 12
  )
  check("reset fences old generation / retains jobs and quota / old exact receipt")
  const { delayed } = await import(`${evidence}/Admit.mjs`)
  const credential = a.cookie
    .split("; ")
    .find((part) => part.startsWith("__Host-playground="))
    .split("=")[1]
  const delayedId = await Effect.runPromise(delayed(cfg, credential, "delayed-native"))
  assert.equal(
    (await sql(`SELECT state FROM "${schema}".jobs WHERE id=$1`, [delayedId]))[0].state,
    "Pending"
  )
  await sql(`UPDATE "${schema}".sandboxes SET viewer_until=1 WHERE sandbox_id=$1`, [
    a.sandbox.ref.sandboxId
  ])
  await describe(b)
  await until(
    async () =>
      (await sql(`SELECT state FROM "${schema}".jobs WHERE id=$1`, [delayedId]))[0]
        .state === "Completed",
    "admitted unattended delayed work did not complete",
    8000
  )
  check(
    "public native enqueue fixture / delayed scheduling / another sandbox viewer permits admitted unattended work"
  )
  // Larger bounded retained backlog; no lifecycle SQL mutation or deletions.
  await sql(`UPDATE "${schema}".sandboxes SET next_generation_at=expires_at`)
  const beforeCost = (
    await sql(
      "SELECT sum(calls)::bigint AS calls, sum(total_exec_time)::float8 AS millis FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())"
    )
  )[0]
  const beforeQueues = await (await dispatch("/_integration/queues")).json()
  const larger = []
  let mutationPage
  for (let batch = 0; batch < 12; batch++) {
    const retained = (
      await sql(`SELECT retained_jobs FROM "${schema}".sandboxes WHERE sandbox_id=$1`, [
        a.sandbox.ref.sandboxId
      ])
    )[0].retained_jobs
    if (retained === 100) {
      break
    }
    const result = await run(
      a,
      `backlog-${batch}`,
      "success",
      Math.min(10, 100 - retained)
    )
    larger.push(...result.jobIds)
    if (batch === 0) {
      mutationPage = await (
        await dispatch(query(a), { headers: { Cookie: a.cookie } })
      ).json()
    } else if (batch === 1 && mutationPage.nextCursor) {
      const afterMutation = await (
        await dispatch(query(a, `&cursor=${mutationPage.nextCursor}`), {
          headers: { Cookie: a.cookie }
        })
      ).json()
      assert(
        !mutationPage.items.some((job) =>
          afterMutation.items.some((next) => job.jobId === next.jobId)
        )
      )
      assert(
        afterMutation.items.every((job) => job.jobId > mutationPage.items.at(-1).jobId)
      )
      check(
        "real keyset pagination retained across concurrent admission and lifecycle mutation"
      )
    }
  }
  assert(larger.length >= 50)
  await until(
    async () =>
      (
        await sql(
          `SELECT count(*)::int AS n FROM "${schema}".jobs WHERE id=ANY($1) AND state='Completed'`,
          [larger]
        )
      )[0].n === larger.length,
    "bounded backlog not completed",
    25000
  )
  const quota = await post("/api/scenarios", a.cookie, a.token, {
    sandbox: a.sandbox.ref,
    requestId: "quota-full",
    scenario: "success",
    count: 1
  })
  assert.equal(quota.status, 429)
  const afterCost = (
    await sql(
      "SELECT sum(calls)::bigint AS calls, sum(total_exec_time)::float8 AS millis FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())"
    )
  )[0]
  const afterQueues = await (await dispatch("/_integration/queues")).json()
  report.observations.backlog = {
    inserted: larger.length,
    retainedQuota: 100,
    queryCalls: Number(afterCost.calls) - Number(beforeCost.calls),
    queryMillis: afterCost.millis - beforeCost.millis,
    queueAlarmCallbacks: afterQueues.map((q, i) => q.calls - beforeQueues[i].calls),
    queueActivations: afterQueues.map(
      (q, i) => q.activations - beforeQueues[i].activations
    )
  }
  const filtered = await (
    await dispatch(query(a, "&state=Completed&kind=playground.welcome-email"), {
      headers: { Cookie: a.cookie }
    })
  ).json()
  assert(
    filtered.items.every(
      (job) =>
        job.state === "Completed" && job.catalog.kind === "playground.welcome-email"
    )
  )
  if (filtered.nextCursor) {
    assert.equal(
      (
        await dispatch(
          query(
            a,
            `&state=Dead&kind=playground.welcome-email&cursor=${filtered.nextCursor}`
          ),
          { headers: { Cookie: a.cookie } }
        )
      ).status,
      400
    )
  }
  check(
    "bounded larger backlog / multiple sandboxes / retained quota / filters / measured PG and DO costs"
  )
  // One authorized viewer keeps all four shared queues alive; zero viewers retires all.
  await sql(`UPDATE "${schema}".sandboxes SET viewer_until=1`)
  await describe(b)
  const alive = await (await dispatch("/_integration/queues")).json()
  assert(alive.every((queue) => queue.alarm !== null))
  await sql(`UPDATE "${schema}".sandboxes SET viewer_until=1`)
  await until(
    async () =>
      (await (await dispatch("/_integration/queues")).json()).every(
        (queue) => queue.alarm === null
      ),
    "all shared queues did not retire",
    8000
  )
  const retired = await (await dispatch("/_integration/queues")).json()
  await describe(b)
  const resumed = await (await dispatch("/_integration/queues")).json()
  assert(resumed.every((queue) => queue.alarm !== null))
  assert(resumed.every((queue, i) => queue.activations > retired[i].activations))
  await sql(`UPDATE "${schema}".sandboxes SET expires_at=1 WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  assert.equal((await describe(b)).status, 401)
  assert.equal((await dispatch(query(b), { headers: { Cookie: b.cookie } })).status, 401)
  check(
    "global last-viewer retirement / describe resumes ALL four queues / DB-time expiry"
  )
  report.status = "PASS"
} catch (error) {
  report.status = "FAIL"
  report.failureClass = error.constructor.name
  if (error.code === "ERR_ASSERTION") {
    report.assertion = {
      actual: error.actual,
      expected: error.expected,
      operator: error.operator
    }
  }
  report.frames = String(error.stack ?? "")
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .map((line) => line.replace(/postgres[^ ]*/g, "[redacted]"))
  process.exitCode = 1
} finally {
  if (browser) {
    await browser.close()
  }
  if (mf) {
    await mf.dispose()
  }
  report.remainingSessions = (
    await sql(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
    )
  )[0].n
  if (report.remainingSessions !== 0) {
    report.status = "FAIL"
    process.exitCode = 1
  }
  await pool.end()
  report.finishedAt = new Date().toISOString()
  writeFileSync(
    `${evidence}/integrated-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
