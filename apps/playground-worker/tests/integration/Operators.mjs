// One disposable native PG + production workerd + actual alias Chromium qualification.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { Pool } from "pg"
import { chromium, expect } from "@playwright/test"
import { createLocal } from "./Local.mjs"
const evidence = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY)
const { migrations } = await import(`${evidence}/Migrations.mjs`)
const drizzle = await import(`${evidence}/NativeDrizzleOperators.mjs`)
const probe = await import(`${evidence}/OperatorProbe.mjs`)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({
  host: "127.0.0.1",
  ...cfg,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const table = (name) => `"${cfg.schema}"."${name}"`
const sql = async (text, values = []) => (await pool.query(text, values)).rows
const checks = [],
  errors = [],
  csp = []
let local, browser
const check = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
try {
  assert.match((await sql("SHOW server_version"))[0].server_version, /^16\.15/)
  await sql(`CREATE SCHEMA "${cfg.schema}"`)
  const all = migrations(cfg.schema)
  assert.equal(all.length, 4)
  for (const m of all.slice(0, 3)) {
    await sql(m.sql)
  }
  // Populated legacy v1-v3 upgrade: accepted source SQL remains checksummed.
  await sql(
    `INSERT INTO ${table("sandboxes")}(sandbox_id,generation,expires_at,credential_hash) VALUES ('legacy',1,253402300799999,'legacy')`
  )
  await sql(
    `INSERT INTO ${table("jobs")}(id,operation,operation_id,slot,queue,kind,version,policy,state,available_at,updated_at) VALUES ('legacy-job','fixture','legacy','job','fixture','fixture',1,'{"maxAttempts":3,"maxStalledCount":1,"leaseDurationMillis":90000,"attemptTimeoutMillis":30000,"retrySchedule":{"_tag":"FixedDelay","delayMillis":5000},"completedRetention":{"_tag":"Duration","durationMillis":2592000000},"deadRetention":{"_tag":"Forever"}}'::jsonb,'Pending',1,1)`
  )
  await sql(`INSERT INTO ${table("associations")} VALUES ('legacy',1,'legacy-job','{}')`)
  const old = await sql(`SELECT * FROM ${table("jobs")} WHERE id='legacy-job'`)
  await sql(all[3].sql)
  assert.deepEqual(await sql(`SELECT * FROM ${table("jobs")} WHERE id='legacy-job'`), old)
  check("populated legacy v1-v3 additive v4 preserves exact row")
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false })
  const dispatch = (origin, path, headers = {}, body) =>
    local.mf.dispatchFetch(origin + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const issue = async (origin = local.origin) => {
    const r = await dispatch(origin, "/api/sandbox/issue")
    assert.equal(r.status, 200)
    const cookies = r.headers.getSetCookie()
    const cookie = cookies.map((v) => v.split(";")[0]).join("; ")
    const credential = cookies
      .find((v) => v.includes("HttpOnly"))
      .split(";")[0]
      .split("=")[1]
    const token = cookies
      .find((v) => v.includes("csrf"))
      .split(";")[0]
      .split("=")[1]
    return { sandbox: await r.json(), cookie, credential, token, origin }
  }
  const a = await issue(),
    b = await issue()
  assert.equal(a.sandbox.capabilities.cancelJob, true)
  const ref = a.sandbox.ref
  const native = (effect) => Effect.runPromise(effect)
  const seed = (state = "Pending", workload = 0, subject = ref) =>
    native(probe.seed(cfg, subject, state, workload))
  const command = async (id, action, extra = {}) => {
    const [row] = await sql(
      `SELECT state,lifecycle_version FROM ${table("jobs")} WHERE id=$1`,
      [id]
    )
    return {
      sandbox: ref,
      requestId: randomUUID(),
      jobId: id,
      expectedState: row.state,
      expectedLifecycleVersion: Number(row.lifecycle_version),
      action,
      ...(action === "redrive" ? { confirmDuplicateEffects: true } : {}),
      ...extra
    }
  }
  const execute = (c, who = a) => native(probe.execute(cfg, who.credential, c))
  const lookup = (c, who = a) =>
    native(
      probe.lookup(cfg, who.credential, { sandbox: c.sandbox, requestId: c.requestId })
    )
  const snapshot = async (id) =>
    (
      await sql(
        `SELECT j.*,encode(p.payload,'hex') AS payload,encode(p.projection,'hex') AS projection FROM ${table("jobs")} j JOIN ${table("job_payloads")} p ON p.job_id=j.id WHERE j.id=$1`,
        [id]
      )
    )[0]
  const pending = await seed()
  const cancel = await command(pending, "cancel")
  const accepted = await execute(cancel)
  assert.equal(accepted._tag, "Committed")
  assert.equal(accepted.resultState, "Cancelled")
  assert.deepEqual(await execute(cancel), accepted)
  assert.deepEqual(await lookup(cancel), accepted)
  const facts = (
    await sql(
      `SELECT j.xmin::text AS job_xid,r.xmin::text AS receipt_xid,a.xmin::text AS audit_xid FROM ${table("jobs")} j JOIN ${table("command_receipts")} r ON r.request_id=$2 JOIN ${table("command_audit")} a ON a.sandbox_id=$3 AND a.observed_at=$4 WHERE j.id=$1`,
      [pending, cancel.requestId, ref.sandboxId, accepted.observedAt]
    )
  )[0]
  assert.equal(facts.job_xid, facts.receipt_xid)
  assert.equal(facts.job_xid, facts.audit_xid)
  await assert.rejects(execute({ ...cancel, expectedLifecycleVersion: 1 }))
  await assert.rejects(execute(cancel, b))
  check(
    "native same-client/xid cancel receipt audit; exact duplicate and altered identity refusal; private isolation"
  )
  const retry = await seed("RetryScheduled", 1)
  const beforeRetry = await snapshot(retry)
  const accelerated = await execute(await command(retry, "retry-now"))
  assert.equal(accelerated._tag, "Committed")
  const afterRetry = await snapshot(retry)
  assert(Number(afterRetry.available_at) < Number(beforeRetry.available_at))
  for (const field of [
    "attempts_made",
    "stalled_count",
    "policy",
    "payload",
    "projection",
    "last_failure_code"
  ]) {
    assert.deepEqual(afterRetry[field], beforeRetry[field])
  }
  check("native retry strictly accelerates without budget/artifact changes")
  const dead = await seed("Dead", 2)
  const beforeDead = await snapshot(dead)
  const redrive = await command(dead, "redrive")
  const successor = await execute(redrive)
  assert.equal(successor._tag, "Committed")
  assert.notEqual(successor.resultJobId, dead)
  assert.deepEqual(await snapshot(dead), beforeDead)
  const fresh = await snapshot(successor.resultJobId)
  assert.equal(Number(fresh.attempts_made), 0)
  assert.equal(fresh.lifecycle_version, "0")
  for (const field of ["policy", "payload", "projection"]) {
    assert.deepEqual(fresh[field], beforeDead[field])
  }
  assert.deepEqual(await execute(redrive), successor)
  const [lineage] = await sql(
    `SELECT l.xmin::text AS lineage_xid,r.xmin::text AS receipt_xid FROM ${table("operator_redrives")} l JOIN ${table("command_receipts")} r USING(sandbox_id,generation,operation,request_id) WHERE request_id=$1`,
    [redrive.requestId]
  )
  assert.equal(lineage.lineage_xid, lineage.receipt_xid)
  const second = await execute(await command(dead, "redrive"))
  assert.notEqual(second.resultJobId, successor.resultJobId)
  check(
    "redrive new ID fresh budget exact bytes unchanged source; atomic lineage; two deliberate confirmations"
  )
  const isolated = await seed("Isolated", 3)
  assert.equal((await execute(await command(isolated, "redrive")))._tag, "Committed")
  const corrupt = await seed("Isolated", 4)
  await sql(
    `UPDATE ${table("job_payloads")} SET payload=decode('7b7d','hex') WHERE job_id=$1`,
    [corrupt]
  )
  const corruptBefore = await snapshot(corrupt)
  const refused = await execute(await command(corrupt, "redrive"))
  assert.equal(refused._tag, "Rejected")
  assert.equal(refused.reason, "invalid-artifact")
  assert.deepEqual(await snapshot(corrupt), corruptBefore)
  const active = await seed("Active", 4)
  const activeBefore = await snapshot(active)
  assert.equal((await execute(await command(active, "cancel")))._tag, "Rejected")
  assert.deepEqual(await snapshot(active), activeBefore)
  check(
    "protected Isolated validation, corrupt rejection nonmutation and Active cancellation denial"
  )
  // Receipt insertion failure after provisional library transition rolls everything back.
  const rollback = await seed()
  await sql(
    `CREATE FUNCTION "${cfg.schema}".reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='Operator' AND NEW.receipt->'command'->>'jobId'='${rollback}' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$`
  )
  await sql(
    `CREATE TRIGGER reject_receipt BEFORE INSERT ON ${table("command_receipts")} FOR EACH ROW EXECUTE FUNCTION "${cfg.schema}".reject_receipt()`
  )
  const rollCommand = await command(rollback, "cancel")
  const rollBefore = await snapshot(rollback)
  assert.equal((await execute(rollCommand))._tag, "OutcomeUnknown")
  assert.deepEqual(await snapshot(rollback), rollBefore)
  await sql(`DROP TRIGGER reject_receipt ON ${table("command_receipts")}`)
  assert.equal((await execute(rollCommand))._tag, "OutcomeUnknown")
  assert.equal((await lookup(rollCommand))._tag, "OutcomeUnknown")
  assert.deepEqual(await snapshot(rollback), rollBefore)
  check(
    "receipt failure rolls back operator; unresolved admission forbids replay even after outage resolves"
  )
  const race = await seed()
  const c1 = await command(race, "cancel"),
    c2 = await command(race, "cancel")
  const raced = await Promise.all([execute(c1), execute(c2)])
  assert.equal(raced.filter((r) => r._tag === "Committed").length, 1)
  assert.equal(
    raced.filter((r) => r._tag === "Rejected" && r.reason === "state-version-conflict")
      .length,
    1
  )
  check("concurrent distinct cancel commands exactly one lifecycle winner")
  const stale = await seed()
  const staleCommand = await command(stale, "cancel")
  await sql(
    `UPDATE ${table("sandboxes")} SET generation=generation+1 WHERE sandbox_id=$1`,
    [ref.sandboxId]
  )
  await assert.rejects(execute(staleCommand))
  assert.equal((await snapshot(stale)).state, "Pending")
  assert.deepEqual(await lookup(cancel), accepted)
  check(
    "reset generation rejects stale mutations; historical exact receipt remains readable"
  )

  const exp = await issue()
  const expId = await seed("Pending", 0, exp.sandbox.ref)
  const expCommand = { ...(await command(expId, "cancel")), sandbox: exp.sandbox.ref }
  await sql(
    `CREATE FUNCTION "${cfg.schema}".delay_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='Operator' AND NEW.receipt->'command'->>'jobId'='${expId}' THEN PERFORM pg_sleep(0.6); END IF; RETURN NEW; END $$`
  )
  await sql(
    `CREATE TRIGGER delay_receipt BEFORE INSERT ON ${table("command_receipts")} FOR EACH ROW EXECUTE FUNCTION "${cfg.schema}".delay_receipt()`
  )
  await sql(
    `UPDATE ${table("sandboxes")} SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint+500 WHERE sandbox_id=$1`,
    [exp.sandbox.ref.sandboxId]
  )
  await assert.rejects(execute(expCommand, exp))
  assert.equal((await snapshot(expId)).state, "Pending")
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM ${table("command_receipts")} WHERE request_id=$1`,
        [expCommand.requestId]
      )
    )[0].n,
    0
  )
  await sql(`DROP TRIGGER delay_receipt ON ${table("command_receipts")}`)
  check(
    "DB-time expiry recheck after receipt delay rolls back library change and receipt"
  )

  const privatePending = await seed("Pending", 0, b.sandbox.ref)
  const privateCommand = {
    ...(await command(privatePending, "cancel")),
    sandbox: b.sandbox.ref
  }
  await sql(`UPDATE ${table("sandboxes")} SET demo_owned=true WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  await assert.rejects(execute(privateCommand, b))
  assert.equal((await snapshot(privatePending)).state, "Pending")
  await sql(`UPDATE ${table("sandboxes")} SET demo_owned=false WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  const quotaSource = await seed("Dead", 5, b.sandbox.ref)
  const quotaCommand = {
    ...(await command(quotaSource, "redrive")),
    sandbox: b.sandbox.ref
  }
  const quotaBefore = await snapshot(quotaSource)
  await sql(`UPDATE ${table("sandboxes")} SET retained_jobs=100 WHERE sandbox_id=$1`, [
    b.sandbox.ref.sandboxId
  ])
  await assert.rejects(execute(quotaCommand, b))
  assert.deepEqual(await snapshot(quotaSource), quotaBefore)
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM ${table("operator_redrives")} WHERE request_id=$1`,
        [quotaCommand.requestId]
      )
    )[0].n,
    0
  )
  check(
    "persisted demo ownership and quota deny native commands without lifecycle/lineage mutation"
  )
  await sql(
    `UPDATE ${table("sandboxes")} SET retained_jobs=(SELECT count(*) FROM ${table("associations")} WHERE sandbox_id=$1) WHERE sandbox_id=$1`,
    [b.sandbox.ref.sandboxId]
  )
  const lost = await seed("Pending", 0, b.sandbox.ref)
  const lostCommand = { ...(await command(lost, "cancel")), sandbox: b.sandbox.ref }
  assert.equal(
    (await native(probe.lostCommit(cfg, b.credential, lostCommand)))._tag,
    "OutcomeUnknown"
  )
  assert.equal((await lookup(lostCommand, b))._tag, "Committed")
  assert.equal((await execute(lostCommand, b))._tag, "Committed")
  assert.equal((await snapshot(lost)).lifecycle_version, "1")
  check(
    "synthetic native COMMIT response loss after durable acceptance reconciles exact receipt without replay"
  )
  await sql(
    `CREATE TABLE ${table("drizzle_operator_receipts")}(job_id text PRIMARY KEY REFERENCES ${table("jobs")}(id),xid bigint NOT NULL)`
  )
  const drizzleId = await seed()
  const drizzleExpected = { jobId: drizzleId, state: "Pending", lifecycleVersion: 0 }
  const dr = await native(
    drizzle.cancel(cfg.connectionString, cfg.schema, drizzleExpected)
  )
  assert.equal(dr.after.state, "Cancelled")
  const [dx] = await sql(
    `SELECT j.xmin::text AS job_xid,r.xid::text AS receipt_xid FROM ${table("jobs")} j JOIN ${table("drizzle_operator_receipts")} r ON r.job_id=j.id WHERE j.id=$1`,
    [drizzleId]
  )
  assert.equal(dx.job_xid, dx.receipt_xid)
  const drizzleRoll = await seed()
  await assert.rejects(
    native(
      drizzle.cancel(
        cfg.connectionString,
        cfg.schema,
        { ...drizzleExpected, jobId: drizzleRoll },
        true
      )
    )
  )
  assert.equal((await snapshot(drizzleRoll)).state, "Pending")
  check(
    "pinned native Drizzle operator joins same xid; rollback removes job transition and domain receipt"
  )
  // Actual browser HTTP, cookies, WS, UI and compiled CSP for each alias.
  browser = await chromium.launch({ headless: true })
  const require = createRequire(resolve("package.json"))
  const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
  for (const host of ["127.0.0.1", "localhost"]) {
    const origin = local.origin.replace("127.0.0.1", host)
    const context = await browser.newContext({
      hasTouch: host === "localhost",
      viewport: { width: 1440, height: 1000 }
    })
    const page = await context.newPage()
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() =>
      document.addEventListener(
        "securitypolicyviolation",
        (e) => (window.__csp = (window.__csp ?? []).concat(e.violatedDirective))
      )
    )
    await page.goto(origin + "/jobs")
    await expect(page.locator(".connection-status")).toHaveAttribute(
      "data-connection",
      "connected",
      { timeout: 20000 }
    )
    const cookies = await context.cookies()
    assert(
      cookies.some(
        (c) => c.httpOnly && !c.secure && c.sameSite === "Strict" && c.domain === host
      )
    )
    const view = await page.evaluate(async () =>
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
    // Freeze only test-owned automatic generation while probing stable background reads.
    await sql(
      `UPDATE ${table("sandboxes")} SET next_generation_at=expires_at WHERE sandbox_id=$1`,
      [view.ref.sandboxId]
    )
    const uiId = await seed("Pending", 0, view.ref)
    await page.reload()
    await page.getByRole("button", { name: uiId, exact: true }).click()
    const trigger = page.getByRole("button", { name: "Cancel job", exact: true })
    await trigger.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog").last()).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
    if (host === "localhost") {
      await trigger.tap()
    } else {
      await trigger.click()
    }
    await page.getByRole("button", { name: "Confirm action", exact: true }).click()
    await expect(page.locator('[aria-label="Job details"]')).toContainText("Cancelled", {
      timeout: 15000
    })
    assert.equal((await snapshot(uiId)).state, "Cancelled")
    const total = await page.evaluate(
      async (ref) =>
        (await (await fetch("/api/jobs?" + new URLSearchParams(ref))).json()).stats,
      { sandboxId: view.ref.sandboxId, generation: String(view.ref.generation) }
    )
    assert.equal(total.Cancelled, 1)
    assert.equal(total.total, 1)
    const filtered = await page.evaluate(
      async (ref) =>
        (
          await fetch("/api/jobs?" + new URLSearchParams({ ...ref, state: "Cancelled" }))
        ).json(),
      { sandboxId: view.ref.sandboxId, generation: String(view.ref.generation) }
    )
    assert.equal(filtered.filteredTotal, 1)
    assert.equal(filtered.stats.Cancelled, 1)
    const aliasCookies = await context.cookies()
    assert.equal(aliasCookies.filter((c) => c.httpOnly).length, 1)
    const other = host === "localhost" ? "127.0.0.1" : "localhost"
    const cookieHeader = aliasCookies.map((c) => `${c.name}=${c.value}`).join("; ")
    assert.equal(
      (
        await dispatch(
          origin,
          "/api/jobs/operator",
          {
            Cookie: cookieHeader,
            Origin: origin.replace(host, other),
            "X-Playground-CSRF": aliasCookies.find((c) => c.name.includes("csrf")).value
          },
          {}
        )
      ).status,
      400
    )
    assert.equal(
      (
        await dispatch(
          origin,
          "/api/jobs/operator",
          { Cookie: cookieHeader, "X-Playground-CSRF": "wrong" },
          {}
        )
      ).status,
      400
    )
    await page.getByRole("button", { name: "Close details" }).click()
    const text = await page.locator(".results-count").textContent()
    const label = page.locator(".results-count")
    await expect(label).toHaveText(text)
    await page.waitForTimeout(10500)
    await expect(label).toHaveText(text)
    assert.equal(await page.locator("style").count(), 0)
    assert.equal(
      await page
        .locator(".jobs-app")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(16, 21, 16)"
    )
    await page.evaluate(axe)
    const audit = await page.evaluate(
      async () =>
        await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
        })
    )
    assert.deepEqual(
      audit.violations.map((v) => v.id),
      []
    )
    csp.push(...(await page.evaluate(() => window.__csp ?? [])))

    const retryUi = await seed("RetryScheduled", 1, view.ref)
    const retryUiBefore = await snapshot(retryUi)
    await page.reload()
    await page.getByRole("button", { name: retryUi, exact: true }).click()
    const retryControl = page.getByRole("button", { name: "Retry now", exact: true })
    if (host === "localhost") {
      await retryControl.tap()
    } else {
      await retryControl.focus()
      await page.keyboard.press("Enter")
    }
    await page.getByRole("button", { name: "Confirm action", exact: true }).click()
    await expect(page.locator('[aria-label="Operator outcome"]')).toContainText(
      "acknowledged",
      { ignoreCase: true }
    )
    const retryUiAfter = await snapshot(retryUi)
    assert(Number(retryUiAfter.available_at) < Number(retryUiBefore.available_at))
    assert.deepEqual(retryUiAfter.policy, retryUiBefore.policy)
    const [retryReceipt] = await sql(
      `SELECT receipt FROM ${table("command_receipts")} WHERE receipt->'result'->>'sourceJobId'=$1 AND receipt->'result'->>'action'='retry-now'`,
      [retryUi]
    )
    assert.equal(retryReceipt.receipt.result._tag, "Committed")
    assert.equal(retryReceipt.receipt.result.resultJobId, retryUi)
    check(
      `${host} retry-now keyboard/touch preserves ID/policy and accelerates authoritative availability`
    )
    await page.getByRole("button", { name: "Close details" }).click()

    // A confirmed response lost after actual server COMMIT retains the request.
    const lostId = await seed("Pending", 0, view.ref)
    await page.reload()
    await page.getByRole("button", { name: lostId, exact: true }).click()
    let lostCommand
    await page.route("**/api/jobs/operator", async (route) => {
      lostCommand = route.request().postDataJSON()
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      await route.abort("failed")
    })
    await page.getByRole("button", { name: "Cancel job", exact: true }).click()
    await page.getByRole("button", { name: "Confirm action", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Check exact request receipt" })
    ).toBeVisible()
    assert.equal((await snapshot(lostId)).state, "Cancelled")
    await expect(
      page.getByRole("button", { name: "Check exact request receipt" })
    ).toBeEnabled()
    await page.unroute("**/api/jobs/operator")
    await page.getByRole("button", { name: "Check exact request receipt" }).click()
    await expect(
      page.getByRole("button", { name: "Check exact request receipt" })
    ).toHaveCount(0)
    assert.equal(
      (
        await sql(
          `SELECT count(*)::int AS n FROM ${table("command_receipts")} WHERE request_id=$1`,
          [lostCommand.requestId]
        )
      )[0].n,
      1
    )
    check(`${host} accepted-response-lost UI exact receipt without replay`)
    await page.getByRole("button", { name: "Close details" }).click()
    const deadUi = await seed("Dead", 2, view.ref)
    await page.reload()
    await page.getByRole("button", { name: deadUi, exact: true }).click()
    const redriveButton = page.getByRole("button", {
      name: "Redrive as new job",
      exact: true
    })
    if (host === "localhost") {
      await redriveButton.tap()
    } else {
      await redriveButton.focus()
      await page.keyboard.press("Enter")
    }
    await expect(page.getByRole("dialog").last()).toContainText(
      "can repeat those effects"
    )
    await page.getByRole("button", { name: "Confirm possible duplicate effects" }).click()
    await expect(
      page.getByRole("button", { name: "Confirm possible duplicate effects" })
    ).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (
            await sql(
              `SELECT count(*)::int AS n FROM ${table("operator_redrives")} WHERE source_job_id=$1`,
              [deadUi]
            )
          )[0].n
      )
      .toBe(1)
    check(`${host} redrive keyboard/touch explicit duplicate-effects confirmation`)

    await page.goto(origin + "/demo")
    await expect(page.locator(".connection-status")).toHaveAttribute(
      "data-connection",
      "connected",
      { timeout: 20000 }
    )
    const denial = await page.evaluate(
      async () =>
        (
          await fetch("/api/demo/jobs/operator", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          })
        ).status
    )
    assert(denial >= 400)
    check(
      `actual ${host} private/demo HTTP+WS, host-only cookies, CSRF/cross-alias denial, keyboard/touch cancel, global/filter Cancelled, stable background/CSP/StyleX/axe`
    )
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(csp, [])
  writeFileSync(
    `${evidence}/operators-report.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        errors,
        csp,
        at: new Date().toISOString(),
        syntheticUnknown:
          "receipt insertion failure after provisional change; no network/crash guarantee",
        limits: ["hosted", "24h soak"]
      },
      null,
      2
    ) + "\n"
  )
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
}
