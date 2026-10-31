// Foreground tooling owns the collector PID, synthetic metric store and all children.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const output = resolve(process.env.OBS_OUTPUT ?? ".toolchain/observability/export")
mkdirSync(output, { recursive: true })
const service =
  process.env.MOTEL_PACKAGE ??
  "/home/pc/.bun/install/global/node_modules/@kitlangton/motel"
assert.equal(
  createRequire(resolve(service, "package.json"))(resolve(service, "package.json"))
    .version,
  "0.2.0"
)
const reserved = createServer()
await new Promise((ok) => reserved.listen(0, "127.0.0.1", ok))
const port = reserved.address().port
await new Promise((ok) => reserved.close(ok))
const base = `http://127.0.0.1:${port}`
const metrics = []
const metricServer = createServer(async (request, response) => {
  if (request.url === "/v1/metrics" && request.method === "POST") {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    metrics.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "content-type": "application/json" }).end("{}")
  } else if (request.url === "/query") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(metrics))
  } else {
    response.writeHead(404).end()
  }
})
await new Promise((ok) => metricServer.listen(0, "127.0.0.1", ok))
const metricBase = `http://127.0.0.1:${metricServer.address().port}`
const log = openSync(resolve(output, "motel.log"), "w")
const child = spawn("bun", [resolve(service, "src/server.ts")], {
  cwd: output,
  env: {
    ...process.env,
    MOTEL_OTEL_BASE_URL: base,
    MOTEL_OTEL_PORT: String(port),
    MOTEL_OTEL_DB_PATH: resolve(output, "telemetry.sqlite"),
    MOTEL_OTEL_ENABLED: "false"
  },
  stdio: ["ignore", log, log]
})
closeSync(log)
const completion = new Promise((ok) =>
  child.once("exit", (code, signal) => ok({ code, signal }))
)
const receipt = {
  pid: child.pid,
  base,
  startedAt: new Date().toISOString(),
  status: "FAIL"
}
const json = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
  assert.ok(response.ok)
  return response.json()
}
try {
  let health
  for (let count = 0; count < 30; count++) {
    try {
      health = await json(`${base}/api/health`)
      break
    } catch {
      await new Promise((ok) => setTimeout(ok, 100))
    }
  }
  assert.ok(health, "owned collector readiness")
  assert.equal(health.workdir, output)
  receipt.health = health
  for (const runtime of process.env.OBS_SOURCE ? ["bun"] : ["node", "bun"]) {
    const target = resolve(output, `${runtime}.json`)
    const execution = spawn(runtime, ["tests/qualification/observability/Consumer.mjs"], {
      env: {
        ...process.env,
        OBS_COLLECTOR_URL: base,
        OBS_METRIC_URL: metricBase,
        OBS_RECEIPT: target
      },
      stdio: "inherit"
    })
    const timer = setTimeout(() => execution.kill("SIGTERM"), 20000)
    const code = await new Promise((ok) => execution.once("exit", ok))
    clearTimeout(timer)
    assert.equal(code, 0, `${runtime} consumer`)
    assert.ok(JSON.parse(readFileSync(target)).captures.length >= 3)
    const sustainedTarget = resolve(output, `${runtime}-sustained.json`)
    const sustained = spawn(
      runtime,
      ["tests/qualification/observability/Sustained.mjs"],
      {
        env: { ...process.env, OBS_RECEIPT: sustainedTarget },
        stdio: "inherit"
      }
    )
    const sustainedTimer = setTimeout(() => sustained.kill("SIGTERM"), 20000)
    const sustainedCode = await new Promise((ok) => sustained.once("exit", ok))
    clearTimeout(sustainedTimer)
    assert.equal(sustainedCode, 0, `${runtime} sustained load`)
    assert.equal(JSON.parse(readFileSync(sustainedTarget)).cases.length, 2)
  }
  const spans = await json(`${base}/api/spans/search?service=jobs-synthetic`)
  const logs = await json(
    `${base}/api/logs/search?service=jobs-synthetic&attr.debug.session=observability`
  )
  const storedMetrics = await json(`${metricBase}/query`)
  writeFileSync(
    resolve(output, "queried.json"),
    JSON.stringify({ spans, logs, metrics: storedMetrics }, null, 2)
  )
  const spanText = JSON.stringify(spans)
  assert.ok(
    spanText.includes("sql.transaction") && spanText.includes("application.positive")
  )
  assert.ok(JSON.stringify(logs).includes("synthetic query control"))
  assert.ok(JSON.stringify(storedMetrics).includes("effect_jobs_operation_total"))
  assert.ok(
    !JSON.stringify({ spans, logs, metrics: storedMetrics }).includes(
      "SYNTHETIC_NATIVE_CONTROL_CANARY"
    )
  )
  receipt.storedQuery = "PASS"
  receipt.status = "PASS"
} finally {
  child.kill("SIGTERM")
  receipt.cleanup = await completion
  await new Promise((ok) => metricServer.close(ok))
  receipt.finishedAt = new Date().toISOString()
  writeFileSync(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2))
}
