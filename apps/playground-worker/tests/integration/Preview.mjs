// User-invoked foreground preview; expiry and Ctrl-C dispose workerd and scoped DB use.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "pg"
import { createLocal } from "./Local.mjs"
const root = resolve(import.meta.dirname, "../../../..")
const { migrations } = await import(`${root}/.multica/integration/Migrations.mjs`)
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
let mf
let poolEnded = false
try {
  await pool.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of migrations(cfg.schema)) {
    await pool.query(migration.sql)
  }
  await pool.end()
  poolEnded = true
  cfg.connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
  const local = await createLocal(cfg, { https: false })
  mf = local.mf
  await mf.dispatchFetch(local.origin + "/demo")
  const readyBy = Date.now() + 60_000
  while (!(await mf.dispatchFetch(local.origin + "/api/demo")).ok) {
    if (Date.now() > readyBy) {
      throw new Error("Demo seed readiness timeout")
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  console.log(
    JSON.stringify({
      url: local.origin + "/jobs",
      demoUrl: local.origin + "/demo",
      expires: process.env.PLAYGROUND_DEADLINE,
      stop: "Ctrl-C in this foreground command; wrapper removes its exact PG container",
      tls: "HTTP loopback preview; no certificate required",
      hosted: "NotTested"
    })
  )
  const remaining = Math.max(
    0,
    new Date(process.env.PLAYGROUND_DEADLINE).getTime() - Date.now() - 10000
  )
  await new Promise((done) => {
    const timer = setTimeout(done, remaining)
    const stop = () => {
      clearTimeout(timer)
      done()
    }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
} catch (error) {
  console.log(JSON.stringify({ status: "FAIL", failureClass: error.constructor.name }))
  process.exitCode = 1
} finally {
  if (mf) {
    await mf.dispose()
  }
  if (!poolEnded) {
    await pool.end()
  }
}
