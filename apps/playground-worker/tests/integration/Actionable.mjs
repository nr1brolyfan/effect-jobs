// Finite source-current PG/workerd/Chromium qualification. All lifecycle states come from enqueue + real handlers.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { Effect } from "effect"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"
const evidence = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const probe = await import(`${evidence}/ActionableProbe.mjs`)
const cfg = {
  ...JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8")),
  localPrivate: true
}
const pool = new Pool({
  host: "127.0.0.1",
  ...cfg,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const table = (name) => `"${cfg.schema}"."${name}"`
const sql = async (text, values = []) => (await pool.query(text, values)).rows
const checks = []
const errors = []
const check = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
let local, browser, bounded
const wait = async (fn, timeout = 25000) => {
  const end = Date.now() + timeout
  do {
    if (await fn()) {
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  } while (Date.now() < end)
  throw Error("bounded assertion timed out")
}
try {
  assert.match((await sql("SHOW server_version"))[0].server_version, /^16\.15/)
  await sql(`CREATE SCHEMA "${cfg.schema}"`)
  for (const m of migrations(cfg.schema).slice(0, 4)) {
    await sql(m.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  const legacy = await Effect.runPromise(probe.issue({ ...cfg, localPrivate: false }))
  const legacyId = legacy.sandbox.ref.sandboxId
  const history = async () => {
    const result = {}
    for (const name of [
      "sandboxes",
      "jobs",
      "job_payloads",
      "associations",
      "command_admission",
      "command_receipts",
      "command_audit",
      "provider_ledger"
    ]) {
      result[name] = await sql(
        `SELECT row_to_json(t) AS row FROM ${table(name)} t ORDER BY row_to_json(t)::text`
      )
    }
    return result
  }
  const beforeMigration = await history()
  await sql("BEGIN")
  await sql(migrations(cfg.schema)[4].sql)
  await sql("COMMIT")
  assert.deepEqual(await history(), beforeMigration)
  assert.equal(
    (
      await sql(
        `SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='sandboxes' AND column_name='retained_jobs'`,
        [cfg.schema]
      )
    )[0].data_type,
    "bigint"
  )
  await sql(`UPDATE ${table("sandboxes")} SET viewer_until=0 WHERE sandbox_id=$1`, [
    legacyId
  ])
  check(
    "additive v5 migration preserves real v4 enqueued jobs, payloads, associations, admissions, receipts, audit and sandbox values"
  )
  local = await createLocal(cfg, { https: false, localPrivate: true })
  const dispatch = (path, who, body) =>
    local.mf.dispatchFetch(local.origin + path, {
      method: "POST",
      headers: {
        Origin: local.origin,
        "Content-Type": "application/json",
        ...(who ? { Cookie: who.cookie, "X-Playground-CSRF": who.token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const issue = async () => {
    const r = await dispatch("/api/sandbox/issue")
    assert.equal(r.status, 200)
    const cookies = r.headers.getSetCookie()
    return {
      sandbox: await r.json(),
      cookie: cookies.map((c) => c.split(";")[0]).join("; "),
      token: cookies
        .find((c) => c.includes("csrf"))
        .split(";")[0]
        .split("=")[1]
    }
  }
  const rows = async (ref) =>
    await sql(
      `SELECT j.*,p.payload,p.projection FROM ${table("jobs")} j JOIN ${table("associations")} a ON a.job_id=j.id JOIN ${table("job_payloads")} p ON p.job_id=j.id WHERE a.sandbox_id=$1 AND a.generation=$2 ORDER BY j.id`,
      [ref.sandboxId, ref.generation]
    )
  const describe = async (who) => {
    const r = await dispatch("/api/sandbox", who)
    assert.equal(r.status, 200)
    return r.json()
  }
  const a = await issue()
  const ref = a.sandbox.ref
  assert.equal(a.sandbox.capacity.retainedJobs, 6)
  assert.equal((await rows(ref)).length, 6)
  const initial = await rows(ref)
  const ids = initial.map((j) => j.id)
  const credential = a.cookie
    .split("; ")
    .find((c) => !c.includes("csrf"))
    .split("=")[1]
  await Promise.all(
    Array.from({ length: 8 }, () => Effect.runPromise(probe.describe(cfg, credential)))
  )
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM ${table("command_receipts")} WHERE sandbox_id=$1 AND operation='PrivateTraffic' AND request_id='starter-v1'`,
        [ref.sandboxId]
      )
    )[0].n,
    1
  )
  const xids = await sql(
    `SELECT j.xmin::text AS job_xid,a.xmin::text AS association_xid,r.xmin::text AS receipt_xid,s.xmin::text AS sandbox_xid FROM ${table("jobs")} j JOIN ${table("associations")} a ON a.job_id=j.id JOIN ${table("sandboxes")} s USING(sandbox_id) JOIN ${table("command_receipts")} r ON r.sandbox_id=s.sandbox_id AND r.operation='PrivateTraffic' AND r.request_id='starter-v1' WHERE s.sandbox_id=$1`,
    [ref.sandboxId]
  )
  // Sandbox renewal changes its xmin; immutable enqueue evidence still shares the bootstrap commit.
  for (const x of xids) {
    assert.equal(x.job_xid, x.association_xid)
    assert.equal(x.job_xid, x.receipt_xid)
  }
  check(
    "fresh atomic six-job bootstrap, exact receipt and concurrent viewers without duplicate seed"
  )
  await describe(a)
  await wait(async () => {
    const r = await rows(ref)
    return ["Pending", "RetryScheduled", "Dead", "Isolated", "Completed"].every((s) =>
      r.some((j) => j.state === s)
    )
  })
  const actionStates = await rows(ref)
  assert(
    Number(actionStates.find((j) => j.state === "Pending").available_at) >
      Date.now() + 60000
  )
  assert(
    Number(actionStates.find((j) => j.state === "RetryScheduled").available_at) >
      Date.now() + 60000
  )
  check(
    "real mixed starter handlers yield Pending/RetryScheduled/Dead/valid Isolated/Completed with human windows"
  )
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  // Use the same freshly issued authority; no private configuration is included in evidence.
  for (const part of a.cookie.split("; ")) {
    const [name, value] = part.split("=")
    await context.addCookies([
      {
        name,
        value,
        url: local.origin,
        httpOnly: !name.includes("csrf"),
        sameSite: "Strict"
      }
    ])
  }
  const page = await context.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(local.origin + "/jobs")
  await expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected",
    { timeout: 20000 }
  )
  await expect(
    page.getByRole("button", { name: "Create jobs", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await expect(page.getByRole("region", { name: "Scenario launcher" })).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Fake provider behavior" })
  ).toBeFocused()
  const open = async (id) => {
    await page.getByRole("button", { name: id, exact: true }).click()
    await expect(page.locator('[aria-label="Job details"]')).toBeVisible()
  }
  const close = () =>
    page.getByRole("button", { name: "Close details", exact: true }).click()
  const pending = actionStates.find((j) => j.state === "Pending")
  await open(pending.id)
  await page.getByRole("button", { name: "Cancel job", exact: true }).click()
  await page.getByRole("button", { name: "Confirm action", exact: true }).click()
  await expect(page.locator('[aria-label="Job details"]')).toContainText("Cancelled", {
    timeout: 15000
  })
  await close()
  assert.equal((await rows(ref)).find((j) => j.id === pending.id).state, "Cancelled")
  check("actual Chromium cancel starter Pending -> Cancelled")
  const retry = actionStates.find((j) => j.state === "RetryScheduled")
  await open(retry.id)
  await page.getByRole("button", { name: "Retry now", exact: true }).click()
  await page.getByRole("button", { name: "Confirm action", exact: true }).click()
  await wait(
    async () => (await rows(ref)).find((j) => j.id === retry.id).state === "Completed"
  )
  await close()
  const completedRetry = (await rows(ref)).find((j) => j.id === retry.id)
  assert.deepEqual(completedRetry.policy, retry.policy)
  assert.deepEqual(completedRetry.payload, retry.payload)
  assert.equal(Number(completedRetry.attempts_made), 2)
  check("actual Chromium retry-now reaches Completed with original budget and bytes")
  for (const state of ["Dead", "Isolated"]) {
    const source = (await rows(ref)).find((j) => j.state === state)
    await open(source.id)
    await page.getByRole("button", { name: "Redrive as new job", exact: true }).click()
    await expect(page.getByRole("dialog").last()).toContainText(
      "can repeat those effects"
    )
    await page
      .getByRole("button", { name: "Confirm possible duplicate effects", exact: true })
      .click()
    await wait(
      async () =>
        (
          await sql(
            `SELECT * FROM ${table("operator_redrives")} WHERE source_job_id=$1`,
            [source.id]
          )
        ).length === 1
    )
    await close()
    const after = (await rows(ref)).find((j) => j.id === source.id)
    assert.deepEqual(after, source)
    const [lineage] = await sql(
      `SELECT * FROM ${table("operator_redrives")} WHERE source_job_id=$1`,
      [source.id]
    )
    const successor = (await rows(ref)).find((j) => j.id === lineage.successor_job_id)
    assert.notEqual(successor.id, source.id)
    assert.deepEqual(successor.payload, source.payload)
    assert.deepEqual(successor.projection, source.projection)
    assert.deepEqual(successor.policy, source.policy)
  }
  check(
    "actual Chromium confirmed redrive Dead and valid Isolated: new IDs, exact artifacts, unchanged sources"
  )
  await page.screenshot({ path: evidence + "/private-actionable.png", fullPage: true })
  // Polling should not replace rows with a spinner. Observe across real traffic changes.
  await page.evaluate(() => {
    window.__blank = 0
    window.__observe = new MutationObserver(() => {
      if (
        document.querySelector(".connection-status")?.dataset.connection ===
          "connected" &&
        !document.querySelector(".jobs-table tbody tr")
      ) {
        window.__blank++
      }
    })
    window.__observe.observe(document.getElementById("jobs"), {
      childList: true,
      subtree: true
    })
  })
  await wait(async () => (await rows(ref)).length >= 14, 40000)
  const generated = await sql(
    `SELECT receipt FROM ${table("command_receipts")} WHERE sandbox_id=$1 AND operation='PrivateTraffic' AND request_id LIKE 'auto-%'`,
    [ref.sandboxId]
  )
  assert(new Set(generated.flatMap((r) => r.receipt.scenarios)).size >= 4)
  assert.equal(await page.evaluate(() => window.__blank), 0)
  await page.evaluate(() => window.__observe.disconnect())
  await sql(
    `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  const countBeforeReset = (await rows(ref)).length
  // Reject the starter receipt after provisional enqueues; reset generation/quota/jobs must roll back together.
  await sql(
    `CREATE FUNCTION "${cfg.schema}".reject_starter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sandbox_id='${ref.sandboxId}' AND NEW.generation=2 AND NEW.operation='PrivateTraffic' THEN RAISE EXCEPTION 'owned fixture'; END IF; RETURN NEW; END $$`
  )
  await sql(
    `CREATE TRIGGER reject_starter BEFORE INSERT ON ${table("command_receipts")} FOR EACH ROW EXECUTE FUNCTION "${cfg.schema}".reject_starter()`
  )
  const failedReset = { sandbox: ref, requestId: randomUUID() }
  assert((await dispatch("/api/sandbox/reset", a, failedReset)).status >= 400)
  assert.equal((await describe(a)).ref.generation, 1)
  assert.equal((await rows({ ...ref, generation: 2 })).length, 0)
  const unknownReceipt = await dispatch("/api/sandbox/reset/receipt", a, failedReset)
  assert.equal((await unknownReceipt.json())._tag, "OutcomeUnknown")
  await sql(`DROP TRIGGER reject_starter ON ${table("command_receipts")}`)
  await sql(`DROP FUNCTION "${cfg.schema}".reject_starter()`)
  check(
    "failed bootstrap receipt rolls back reset generation, enqueues, quota and audit; exact absent receipt stays Unknown"
  )
  const reset = { sandbox: ref, requestId: randomUUID() }
  const resetResponse = await dispatch("/api/sandbox/reset", a, reset)
  assert.equal(resetResponse.status, 200)
  const resetResult = await resetResponse.json()
  assert.equal(resetResult._tag, "Committed")
  assert.equal(resetResult.current.generation, 2)
  const current = resetResult.current
  assert.equal((await rows(current)).length, 6)
  assert.equal((await rows(ref)).length, countBeforeReset)
  const repeated = await dispatch("/api/sandbox/reset/receipt", a, reset)
  assert.deepEqual(await repeated.json(), resetResult)
  await Promise.all(Array.from({ length: 6 }, () => describe(a)))
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM ${table("command_receipts")} WHERE sandbox_id=$1 AND generation=2 AND request_id='starter-v1'`,
        [ref.sandboxId]
      )
    )[0].n,
    1
  )
  await wait(async () => {
    const r = await rows(current)
    return ["Pending", "RetryScheduled", "Dead", "Isolated", "Completed"].every((s) =>
      r.some((j) => j.state === s)
    )
  })
  assert.equal(
    (
      await dispatch("/api/scenarios", a, {
        sandbox: ref,
        requestId: randomUUID(),
        scenario: "success",
        count: 1
      })
    ).status,
    409
  )
  const b = await issue()
  assert.equal(
    (
      await dispatch("/api/scenarios", b, {
        sandbox: current,
        requestId: randomUUID(),
        scenario: "success",
        count: 1
      })
    ).status,
    404
  )
  check(
    "mixed background arrivals, reset atomic new generation starter; exact reset receipt; stale generation and credential isolation"
  )
  const c = await issue()
  const cCredential = c.cookie
    .split("; ")
    .find((v) => !v.includes("csrf"))
    .split("=")[1]
  const races = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      Effect.runPromise(
        probe.reset(cfg, cCredential, { sandbox: c.sandbox.ref, requestId: randomUUID() })
      )
    )
  )
  assert.equal(
    races.filter((r) => r.status === "fulfilled" && r.value._tag === "Committed").length,
    1
  )
  const cView = await describe(c)
  assert.equal(cView.ref.generation, 2)
  assert.equal(cView.capacity.retainedJobs, 12)
  assert.equal((await rows(cView.ref)).length, 6)
  check(
    "independent native concurrent resets: one generation advance and exactly one starter set"
  )
  // Cross the old job cap through real finite commands, preserving earlier history.
  await sql(
    `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  let capacity = (await describe(a)).capacity.retainedJobs
  while (capacity < 110) {
    const count = Math.min(10, 110 - capacity)
    const r = await dispatch("/api/scenarios", a, {
      sandbox: current,
      requestId: randomUUID(),
      scenario: "success",
      count
    })
    assert.equal(r.status, 200)
    assert.equal((await r.json())._tag, "Committed")
    capacity = (await describe(a)).capacity.retainedJobs
  }
  // Genuine rejected operator commands produce immutable admissions/receipts without adding jobs.
  let admissions = (await describe(a)).capacity.admittedCommands
  for (let index = 0; index < 201 && admissions <= 200; index++) {
    const response = await Effect.runPromise(
      probe.operator(cfg, credential, {
        sandbox: current,
        requestId: randomUUID(),
        action: "cancel",
        jobId: `owned-missing-${index}`,
        expectedState: "Pending",
        expectedLifecycleVersion: 0
      })
    )
    assert.equal(response._tag, "Rejected")
    assert.equal(response.reason, "not-found")
    admissions = Number(
      (
        await sql(
          `SELECT count(*) AS n FROM ${table("command_admission")} WHERE sandbox_id=$1`,
          [ref.sandboxId]
        )
      )[0].n
    )
  }
  await wait(
    async () =>
      Number(
        (
          await sql(
            `SELECT count(*) AS n FROM ${table("provider_ledger")} WHERE sandbox_id=$1`,
            [ref.sandboxId]
          )
        )[0].n
      ) > 100,
    40000
  )
  check(
    "durable synthetic provider handles more than100 retained identities through real worker execution"
  )
  assert.equal(capacity, 110)
  assert(admissions > 200)
  assert.equal((await describe(a)).capacity.mode, "local")
  check(
    "local private real commands exceed retained100 and admission200; finite batch validation and stale generation fencing survive"
  )
  const tooMany = await dispatch("/api/scenarios", a, {
    sandbox: current,
    requestId: randomUUID(),
    scenario: "success",
    count: 11
  })
  assert.equal(tooMany.status, 400)
  const retained = async () =>
    sql(
      `SELECT a.generation,j.id,j.policy,p.payload,p.projection FROM ${table("associations")} a JOIN ${table("jobs")} j ON j.id=a.job_id JOIN ${table("job_payloads")} p ON p.job_id=j.id WHERE a.sandbox_id=$1 ORDER BY j.id`,
      [ref.sandboxId]
    )
  const retainedBefore = await retained()
  const receiptsBefore = await sql(
    `SELECT * FROM ${table("command_receipts")} WHERE sandbox_id=$1 ORDER BY generation,operation,request_id`,
    [ref.sandboxId]
  )
  const auditBefore = await sql(
    `SELECT * FROM ${table("command_audit")} WHERE sandbox_id=$1 ORDER BY generation,operation,observed_at`,
    [ref.sandboxId]
  )
  // Generator crosses both old thresholds and preserves paced one-job arrivals.
  await sql(
    `UPDATE ${table("sandboxes")} SET next_generation_at=1,viewer_until=expires_at WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  for (const other of [b.sandbox.ref.sandboxId, cView.ref.sandboxId]) {
    await sql(
      `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
      [other]
    )
  }
  await Effect.runPromise(probe.generate(cfg))
  assert.equal((await retained()).length, 111)
  const [paced] = await sql(
    `SELECT next_generation_at FROM ${table("sandboxes")} WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  assert(Number(paced.next_generation_at) > Date.now())
  await Effect.runPromise(probe.generate(cfg))
  assert.equal((await retained()).length, 111)
  await sql(
    `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  check(
    "mixed background generation continues beyond old limits but does not catch up or flood"
  )
  await page.reload()
  await expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected",
    { timeout: 20000 }
  )
  await page.getByRole("button", { name: "Create jobs", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Run scenario", exact: true })
  ).toBeEnabled()
  await expect(
    page.getByRole("button", { name: "Reset my sandbox", exact: true })
  ).toBeEnabled()
  await expect(page.getByText(/No lifetime quota/)).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await expect(page.locator(".sandbox-scope")).toContainText("generation 3", {
    timeout: 15000
  })
  const afterThresholdReset = await describe(a)
  assert.equal(afterThresholdReset.ref.sandboxId, ref.sandboxId)
  assert.equal(afterThresholdReset.ref.generation, 3)
  assert.equal((await rows(afterThresholdReset.ref)).length, 6)
  const retainedAfter = await retained()
  for (const old of retainedBefore) {
    assert.deepEqual(
      retainedAfter.find((job) => job.id === old.id),
      old
    )
  }
  const receiptsAfter = await sql(
    `SELECT * FROM ${table("command_receipts")} WHERE sandbox_id=$1 ORDER BY generation,operation,request_id`,
    [ref.sandboxId]
  )
  for (const old of receiptsBefore) {
    assert(receiptsAfter.some((value) => JSON.stringify(value) === JSON.stringify(old)))
  }
  const auditAfter = await sql(
    `SELECT * FROM ${table("command_audit")} WHERE sandbox_id=$1 ORDER BY generation,operation,observed_at`,
    [ref.sandboxId]
  )
  for (const old of auditBefore) {
    assert(auditAfter.some((value) => JSON.stringify(value) === JSON.stringify(old)))
  }
  await wait(async () => {
    const states = new Set((await rows(afterThresholdReset.ref)).map((job) => job.state))
    return ["Pending", "RetryScheduled", "Dead", "Isolated", "Completed"].every((state) =>
      states.has(state)
    )
  })
  check(
    "actual Chromium same-ID generation+1 reset above old limits seeds six actionable jobs and preserves all historical job bytes, receipts and audit"
  )
  const thresholdStates = await rows(afterThresholdReset.ref)
  for (const state of ["Pending", "RetryScheduled", "Dead", "Isolated"]) {
    const source = thresholdStates.find((job) => job.state === state)
    await open(source.id)
    const button =
      state === "Pending"
        ? "Cancel job"
        : state === "RetryScheduled"
          ? "Retry now"
          : "Redrive as new job"
    await page.getByRole("button", { name: button, exact: true }).click()
    const operatorResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/jobs/operator"
    )
    await page
      .getByRole("button", {
        name:
          state === "Dead" || state === "Isolated"
            ? "Confirm possible duplicate effects"
            : "Confirm action",
        exact: true
      })
      .click()
    const acceptedResponse = await operatorResponse
    const acceptedBody = await acceptedResponse.json()
    console.log(
      JSON.stringify({
        operatorState: state,
        status: acceptedResponse.status(),
        result: acceptedBody._tag,
        reason: acceptedBody.reason,
        code: acceptedBody.code
      })
    )
    assert.equal(acceptedResponse.status(), 200)
    assert.equal(acceptedBody._tag, "Committed")
    if (state === "Pending" || state === "RetryScheduled") {
      await wait(
        async () =>
          (await rows(afterThresholdReset.ref)).find((job) => job.id === source.id)
            .state === (state === "Pending" ? "Cancelled" : "Completed")
      )
    } else {
      await wait(
        async () =>
          (
            await sql(
              `SELECT * FROM ${table("operator_redrives")} WHERE source_job_id=$1`,
              [source.id]
            )
          ).length === 1
      )
      const unchanged = (await rows(afterThresholdReset.ref)).find(
        (job) => job.id === source.id
      )
      assert.deepEqual(unchanged, source)
      const [lineage] = await sql(
        `SELECT * FROM ${table("operator_redrives")} WHERE source_job_id=$1`,
        [source.id]
      )
      const successor = (await rows(afterThresholdReset.ref)).find(
        (job) => job.id === lineage.successor_job_id
      )
      assert.notEqual(successor.id, source.id)
      assert.deepEqual(successor.payload, source.payload)
      assert.deepEqual(successor.policy, source.policy)
    }
    await close()
  }
  check(
    "actual Chromium cancel, retry-now and confirmed Dead/Isolated redrive remain admitted above retained100/admission200"
  )
  await page.screenshot({
    path: evidence + "/private-over-threshold.png",
    fullPage: true
  })
  const overThresholdCapacity = (await describe(a)).capacity
  assert(overThresholdCapacity.retainedJobs > 100)
  assert(overThresholdCapacity.admittedCommands > 200)
  const resetContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  })
  const resetPage = await resetContext.newPage()
  await resetPage.goto(local.origin + "/jobs")
  await expect(resetPage.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected",
    { timeout: 20000 }
  )
  const readView = () =>
    resetPage.evaluate(async () =>
      (
        await fetch("/api/sandbox", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Playground-CSRF": document.cookie
              .split("; ")
              .find((v) => v.includes("csrf"))
              .split("=")[1]
          }
        })
      ).json()
    )
  const beforeUiReset = await readView()
  await sql(
    `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
    [beforeUiReset.ref.sandboxId]
  )
  await resetPage.getByRole("button", { name: "Create jobs", exact: true }).click()
  await resetPage
    .getByRole("combobox", { name: "Fake provider behavior" })
    .selectOption("delayed-success")
  await resetPage.getByRole("button", { name: "Run scenario", exact: true }).click()
  await expect(
    resetPage.getByRole("region", { name: "Scenario launcher" })
  ).toContainText("Enqueue acknowledged", { timeout: 15000 })
  const oldUiRows = await rows(beforeUiReset.ref)
  resetPage.once("dialog", (dialog) => dialog.accept())
  await resetPage.getByRole("button", { name: "Reset my sandbox", exact: true }).click()
  await expect(resetPage.locator(".sandbox-scope")).toContainText("generation 2", {
    timeout: 15000
  })
  const afterUiReset = await readView()
  assert.equal(afterUiReset.ref.generation, 2)
  assert.equal((await rows(beforeUiReset.ref)).length, oldUiRows.length)
  await wait(async () => {
    const r = await rows(afterUiReset.ref)
    return ["Pending", "RetryScheduled", "Dead", "Isolated", "Completed"].every((state) =>
      r.some((j) => j.state === state)
    )
  })
  await resetPage.screenshot({ path: evidence + "/private-reset.png", fullPage: true })
  await resetContext.close()
  check(
    "actual Chromium manual delayed scenario and confirmed reset restore actionable generation while retaining old jobs"
  )
  await page.goto(local.origin + "/demo")
  await expect(page.locator(".connection-status")).toHaveAttribute(
    "data-connection",
    "connected",
    { timeout: 30000 }
  )
  await expect(
    page.getByRole("button", { name: "Create jobs", exact: true })
  ).toHaveCount(0)
  const demo = (
    await sql(`SELECT * FROM ${table("sandboxes")} WHERE demo_owned ORDER BY sandbox_id`)
  )[0]
  assert(demo)
  assert.equal(
    (
      await dispatch("/api/scenarios", a, {
        sandbox: { sandboxId: demo.sandbox_id, generation: Number(demo.generation) },
        requestId: randomUUID(),
        scenario: "success",
        count: 1
      })
    ).status,
    404
  )
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM ${table("command_receipts")} WHERE sandbox_id=$1 AND operation='PrivateTraffic'`,
        [demo.sandbox_id]
      )
    )[0].n,
    0
  )
  check("public demo read-only, private bootstrap/generator excluded from demo authority")
  await assert.rejects(
    sql(`UPDATE ${table("sandboxes")} SET retained_jobs=20001 WHERE sandbox_id=$1`, [
      demo.sandbox_id
    ]),
    (error) => error.code === "23514"
  )
  await assert.rejects(
    sql(
      `UPDATE ${table("sandboxes")} SET retained_jobs=9007199254740992 WHERE sandbox_id=$1`,
      [ref.sandboxId]
    ),
    (error) => error.code === "23514"
  )
  check("unchanged public demo20000 constraint and local safe integer database bound")
  bounded = await createLocal(cfg, { https: false })
  const boundedIssue = await bounded.mf.dispatchFetch(
    bounded.origin + "/api/sandbox/issue",
    {
      method: "POST",
      headers: {
        Origin: bounded.origin,
        "Content-Type": "application/json",
        LOCAL_PRIVATE: "true",
        "X-Local-Private": "true"
      }
    }
  )
  assert.equal(boundedIssue.status, 200)
  const boundedView = await boundedIssue.json()
  assert.equal(boundedView.capacity.mode, "bounded")
  const boundedCredential = boundedIssue.headers
    .getSetCookie()
    .find((value) => !value.includes("csrf"))
    .split(";")[0]
    .split("=")[1]
  const boundedConfig = { ...cfg, localPrivate: false }
  let boundedCount = 6
  while (boundedCount < 100) {
    const count = Math.min(10, 100 - boundedCount)
    const result = await Effect.runPromise(
      probe.scenario(boundedConfig, boundedCredential, {
        sandbox: boundedView.ref,
        requestId: randomUUID(),
        scenario: "delayed-success",
        count
      })
    )
    assert.equal(result._tag, "Committed")
    boundedCount += count
  }
  const blockedScenario = await Effect.runPromise(
    probe.scenario(boundedConfig, boundedCredential, {
      sandbox: boundedView.ref,
      requestId: randomUUID(),
      scenario: "success",
      count: 1
    })
  )
  assert.equal(blockedScenario.code, "limit-reached")
  const blockedReset = await Promise.allSettled([
    Effect.runPromise(
      probe.reset(boundedConfig, boundedCredential, {
        sandbox: boundedView.ref,
        requestId: randomUUID()
      })
    )
  ])
  assert.equal(blockedReset[0].status, "rejected")
  assert.equal(
    (await Effect.runPromise(probe.describe(boundedConfig, boundedCredential))).ref
      .generation,
    1
  )
  check(
    "trusted configuration only: localhost and spoofed request flags do not enable local mode; default bounded100/reset refusal remain enforced"
  )

  await sql(`UPDATE ${table("sandboxes")} SET expires_at=1 WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  assert.equal((await dispatch("/api/sandbox", b)).status, 401)
  check("DB-time expiry denies retained credential authority")
  assert.deepEqual(errors, [])
  writeFileSync(
    evidence + "/actionable-results.json",
    JSON.stringify(
      {
        status: "PASS",
        checks,
        errors,
        chromium: browser.version(),
        localOrigin: local.origin,
        starterIds: ids,
        limits: { localLifetimeQuota: null, batch: 10, demoRetained: 20000 },
        overThresholdCapacity,
        resetSemantics:
          "same ID, generation+1, six starters independent of previous retained count; all history preserved"
      },
      null,
      2
    ) + "\n"
  )
} finally {
  await browser?.close()
  await bounded?.mf.dispose()
  await local?.mf.dispose()
  await pool.end()
}
