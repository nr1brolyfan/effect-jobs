import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"
import { chromium } from "@playwright/test"
import { createLocal } from "./Local.mjs"
const { migrations } = await import(process.env.D6_RESOURCE_DIRECTORY + "/Migrations.mjs")
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({ ...cfg, connectionTimeoutMillis: 2000, statement_timeout: 5000 })
const report = { checks: [], hosted: "NotTested", success: false }
let local, browser
const until = async (test, label, ms = 20000) => {
  const end = Date.now() + ms
  while (!(await test())) {
    assert(Date.now() < end, label)
    await new Promise((r) => setTimeout(r, 100))
  }
}
try {
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const m of migrations(cfg.schema)) {
    await pool.query(m.sql)
  }
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  local = await createLocal(cfg, { https: false, localPrivate: true })
  const dispatch = (path, init = {}) => local.mf.dispatchFetch(local.origin + path, init)
  assert.equal(
    (
      await dispatch("/api/sandbox/issue", {
        method: "POST",
        headers: { Origin: "https://foreign.invalid" }
      })
    ).status,
    400
  )
  const issued = await dispatch("/api/sandbox/issue", {
    method: "POST",
    headers: { Origin: local.origin, "Content-Type": "application/json" }
  })
  assert.equal(issued.status, 200)
  const view = await issued.json()
  const cookies = issued.headers.getSetCookie().map((v) => v.split(";")[0])
  const cookie = cookies.join("; ")
  const token = cookies.find((v) => v.split("=")[0].includes("csrf")).split("=")[1]
  const post = (path, body) =>
    dispatch(path, {
      method: "POST",
      headers: {
        Origin: local.origin,
        Cookie: cookie,
        "X-Playground-CSRF": token,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  const command = {
    sandbox: view.ref,
    requestId: "focused-dedup",
    scenario: "deduplication",
    count: 2
  }
  const first = await post("/api/scenarios", command)
  assert.equal(first.status, 200)
  const produced = await first.json()
  assert.equal(produced._tag, "Committed")
  assert.equal(produced.jobIds.length, 2)
  const replay = await (await post("/api/scenarios", command)).json()
  assert.deepEqual(replay.jobIds, produced.jobIds)
  report.checks.push(
    "real HTTP origin admission; sequential transactional scenario dedup and exact receipt replay"
  )
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.addCookies(
    cookies.map((v) => {
      const i = v.indexOf("=")
      return { name: v.slice(0, i), value: v.slice(i + 1), url: local.origin }
    })
  )
  await context.addInitScript(() => {
    const Original = window.WebSocket
    window.__taskSockets = []
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args)
        window.__taskSockets.push(this)
      }
    }
  })
  const page = await context.newPage()
  let ready = 0,
    changed = 0
  page.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      try {
        const s = JSON.parse(String(frame.payload))
        if (s.kind === "ready") {
          ready++
        }
        if (s.reason === "jobs-changed") {
          changed++
        }
      } catch {}
    })
  )
  await page.goto(local.origin + "/jobs")
  await until(() => ready > 0, "browser live ready")
  assert((await page.locator("body").textContent()).includes("Jobs"))
  await post("/api/scenarios", {
    ...command,
    requestId: "focused-change",
    scenario: "success"
  })
  await until(() => changed > 0, "browser post-commit invalidation")
  await page.evaluate(() =>
    window.__taskSockets.forEach((socket) =>
      socket.close(1000, "task reconnection probe")
    )
  )
  await until(() => ready >= 2, "browser reconnect ready")
  await context.close()
  report.checks.push(
    "Chromium actual jobs UI; authorized WebSocket ready, post-commit invalidation and controlled socket-close reconnect"
  )
  const liveContext = await browser.newContext()
  await liveContext.addCookies(
    cookies.map((v) => {
      const i = v.indexOf("=")
      return { name: v.slice(0, i), value: v.slice(i + 1), url: local.origin }
    })
  )
  const livePage = await liveContext.newPage()
  await livePage.goto(local.origin + "/docs/jobs")
  const socket = async (key) => {
    await livePage.evaluate((key) => {
      window.__liveProbes ??= {}
      const record = { frames: [], closed: [], ack: false }
      const ws = new WebSocket(location.origin.replace("http", "ws") + "/api/changes")
      record.ws = ws
      ws.addEventListener("message", (e) => {
        const frame = JSON.parse(e.data)
        record.frames.push(frame)
        if (record.ack) {
          ws.send(JSON.stringify({ kind: "ack", sequence: frame.sequence }))
        }
      })
      ws.addEventListener("close", (e) => record.closed.push(e.code))
      window.__liveProbes[key] = record
    }, key)
    await until(
      () => livePage.evaluate((key) => window.__liveProbes[key].frames.length > 0, key),
      "socket ready"
    )
  }
  await socket("slow")
  await until(
    () => livePage.evaluate(() => window.__liveProbes.slow.closed.length > 0),
    "slow viewer closed",
    18000
  )
  assert.equal(await livePage.evaluate(() => window.__liveProbes.slow.closed[0]), 4008)
  report.checks.push(
    "actual Chromium/workerd transport closes unacknowledged ready with 4008 inside original 18s bound"
  )
  await socket("expired")
  await livePage.evaluate(() => {
    const p = window.__liveProbes.expired
    p.ack = true
    p.ws.send(JSON.stringify({ kind: "ack", sequence: p.frames[0].sequence }))
  })
  await pool.query(
    `UPDATE "${cfg.schema}".sandboxes SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1 WHERE sandbox_id=$1`,
    [view.ref.sandboxId]
  )
  await until(
    () => livePage.evaluate(() => window.__liveProbes.expired.closed.length > 0),
    "expired authority closes socket",
    12000
  )
  assert.equal(await livePage.evaluate(() => window.__liveProbes.expired.closed[0]), 4003)
  report.checks.push(
    "actual Chromium/workerd alarm rechecks PostgreSQL authority and closes expired sandbox with 4003 inside original12s bound"
  )
  await liveContext.close()
  report.success = true
} catch (e) {
  report.failureClass = e.name
  report.reason = e.message?.slice(0, 160)
  process.exitCode = 1
} finally {
  await browser?.close()
  await local?.mf.dispose()
  await pool.end()
  report.servicesClosed = true
  writeFileSync(
    process.env.D6_RESOURCE_DIRECTORY + "/focused-receipt.json",
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report))
}
