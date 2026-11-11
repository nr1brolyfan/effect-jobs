import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Pool } from "pg"
import WebSocket from "ws"
import { Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { Signal } from "@effect-jobs/playground-contracts/LiveProtocol"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"

const { createLocal, readQualificationConfiguration } = (await import(
  new URL("./Local.ts", import.meta.url).href
)) as typeof import("./Local.js")

const directory = resolve(process.env.PLAYGROUND_EVIDENCE_DIRECTORY!)
const config = readQualificationConfiguration()
config.connectionString = `postgres://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}`
const pool = new Pool({
  connectionString: config.connectionString,
  connectionTimeoutMillis: 2000
})
const { migrations } = (await import(`${directory}/Migrations.mjs`)) as {
  migrations: (schema: string) => ReadonlyArray<{ sql: string }>
}
const checks: string[] = []
const observations: unknown[] = []
let local: Awaited<ReturnType<typeof createLocal>> | undefined
const sockets: WebSocket[] = []
const firstSignal = (path: string, cookie?: string) =>
  new Promise<unknown>((done, reject) => {
    const socket = new WebSocket(local!.origin.replace("http:", "ws:") + path, {
      headers: { Origin: local!.origin, ...(cookie ? { Cookie: cookie } : {}) }
    })
    sockets.push(socket)
    const timeout = setTimeout(
      () => reject(new Error("native socket readiness deadline")),
      10000
    )
    const finish = (value: unknown) => {
      clearTimeout(timeout)
      done(value)
    }
    socket.once("message", (message) => {
      const bytes = Array.isArray(message)
        ? Buffer.concat(message)
        : message instanceof ArrayBuffer
          ? Buffer.from(message)
          : message
      finish(JSON.parse(bytes.toString("utf8")))
    })
    socket.once("unexpected-response", (_request, response) => {
      response.resume()
      finish({ status: response.statusCode })
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      reject(new Error("native socket failed"))
    })
  })
try {
  await pool.query("SELECT 1")
  await pool.query(`CREATE SCHEMA "${config.schema}"`)
  for (const migration of migrations(config.schema)) {
    await pool.query(migration.sql)
  }
  local = await createLocal(config, { localPrivate: true })
  const issued = await fetch(local.origin + "/api/sandbox/issue", {
    method: "POST",
    headers: { Origin: local.origin, "Content-Type": "application/json" }
  })
  observations.push({ issueStatus: issued.status })
  assert.equal(issued.status, 200)
  const sandbox = Schema.decodeUnknownSync(SandboxView)(await issued.json())
  const names = Cookies.names(local.origin, true)
  const cookies = issued.headers.getSetCookie()
  assert(
    cookies.some(
      (value) =>
        value.startsWith(names.credential + "=") &&
        value.includes("HttpOnly") &&
        !value.includes("Secure")
    )
  )
  assert(cookies.some((value) => value.startsWith(names.csrf + "=")))
  const cookie = cookies.map((value) => value.split(";")[0]).join("; ")
  const signal = Schema.decodeUnknownSync(Signal)(
    await firstSignal("/api/changes", cookie)
  )
  assert.equal(signal.kind, "ready")
  assert.deepEqual(signal.sandbox, sandbox.ref)
  checks.push(
    "production private HTTP admission and native socket ready preserve authority"
  )
  for (const socket of sockets) {
    socket.close()
  }
  await local.mf.dispose()
  local = await createLocal(config, {
    localPrivate: process.argv.includes("--combined-private")
  })
  const deadline = Date.now() + 30000
  let response: Response
  do {
    response = await fetch(local.origin + "/api/demo")
    if (response.status === 200) {
      break
    }
    assert(Date.now() < deadline, "native demo readiness")
    await new Promise((done) => setTimeout(done, 200))
  } while (response.status !== 200)
  const demo = Schema.decodeUnknownSync(SandboxView)(await response.json())
  checks.push("production public demo publishes only after durable generator readiness")
  const publicSignal = await firstSignal("/api/demo/changes")
  observations.push({ publicSignal })
  const decoded = Schema.decodeUnknownSync(Signal)(publicSignal)
  assert.equal(decoded.kind, "ready")
  assert.deepEqual(decoded.sandbox, demo.ref)
  checks.push("public demo native socket ready preserves current generation")
  const query = new URLSearchParams({
    sandboxId: demo.ref.sandboxId,
    generation: String(demo.ref.generation),
    limit: "20"
  })
  const page = await fetch(local.origin + "/api/demo/jobs?" + query)
  observations.push({ pageStatus: page.status })
  assert.equal(page.status, 200)
  checks.push("public demo jobs read follows native socket admission")
  await writeFile(
    resolve(directory, "native-host-results.json"),
    JSON.stringify({ status: "PASS", checks, observations }, null, 2)
  )
} catch (error) {
  await writeFile(
    resolve(directory, "native-host-results.json"),
    JSON.stringify(
      {
        status: "FAIL",
        checks,
        observations,
        failureClass: error instanceof Error ? error.name : "unknown"
      },
      null,
      2
    )
  )
  throw new Error("Native host qualification failed; see bounded results")
} finally {
  for (const socket of sockets) {
    socket.close()
    socket.terminate()
  }
  try {
    await local?.mf.dispose()
  } finally {
    await pool.end()
  }
  // Ensure the staged asset contract used actual build output, never source.
  const pointer = JSON.parse(
    await readFile("apps/playground-worker/dist/native.json", "utf8")
  ) as { directory: string }
  assert(pointer.directory.includes("native-build-"))
}
