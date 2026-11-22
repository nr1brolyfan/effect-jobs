import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { createPool } from "drizzle-orm/postgres/client"
import { makeDevelopmentProvider } from "./DevelopmentProvider.mjs"
const provider = makeDevelopmentProvider()
const deliveries = provider.effects
const database = process.env.EXAMPLE_TEST_DATABASE_URL
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: readFileSync(".toolchain/worker.mjs", "utf8"),
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      PROBE: { className: "Probe", useSQLite: true },
      BRIDGE: { className: "BridgeProbe", useSQLite: true }
    },
    durableObjectsPersist: false,
    hyperdrives: database ? { PG: database } : {},
    outboundService: async (request) => {
      assert.equal(new URL(request.url).hostname, "provider.invalid")
      return provider.accept(request)
    }
  })
)
const receipts = []
const call = async (path, init) => {
  const response = await mf.dispatchFetch("https://example.invalid/" + path, init)
  const body = await response.json()
  return { response, body }
}
try {
  const development = makeDevelopmentProvider()
  const providerRequest = (body) =>
    new Request("https://provider.invalid", {
      method: "POST",
      headers: { "idempotency-key": "stable-effect" },
      body
    })
  assert.equal((await development.accept(providerRequest("same"))).status, 204)
  assert.equal((await development.accept(providerRequest("same"))).status, 204)
  assert.equal((await development.accept(providerRequest("different"))).status, 409)
  assert.equal(development.effects.size, 1)
  assert.equal(development.repeated, 1)
  receipts.push("development provider equal-key dedup and content conflict PASS")
  await call("bridge-scope")
  const bridgeSecond = (await call("bridge-scope")).body
  assert.equal(bridgeSecond.acquired, 2)
  assert.equal(bridgeSecond.released, 1)
  await call("bridge-start")
  let bridge
  for (let index = 0; index < 100; index++) {
    bridge = (await call("bridge-inspect")).body
    if (bridge.acquired === 3 && bridge.released === 3) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.deepEqual(bridge, { acquired: 3, released: 3 })
  receipts.push(
    "actual Alchemy DurableObjectBridge RPC/callback invocation Scope cleanup PASS"
  )
  const prearm = (await call("prearm")).body
  assert.equal(prearm.rows.length, 1)
  assert(prearm.alarm)
  const retained = (await call("prearm")).body
  assert.equal(retained.rows[0].version, prearm.rows[0].version)
  const delivered = (await call("fire")).body
  assert.equal(delivered.calls, 1)
  assert.equal(delivered.closed, 1)
  assert.equal(delivered.rows.length, 1)
  assert.notEqual(
    delivered.rows[0].version,
    prearm.rows[0].version,
    "same-ID replacement must survive ack"
  )
  const failed = (await call("fire?mode=error")).body
  assert.equal(failed.calls, 2)
  assert.equal(failed.closed, 2)
  assert.equal(failed.rows.length, 1, "prearm remains on a failed drain")
  const interrupted = (await call("fire?mode=interrupt")).body
  assert.equal(interrupted.calls, 3)
  assert.equal(interrupted.closed, 3)
  assert.equal(interrupted.rows.length, 1)
  let parked
  for (let index = 0; index < 8; index++) {
    parked = (await call("fire?advance=3600000")).body
  }
  assert.equal(parked.rows.length, 1)
  assert.equal(parked.rows[0].parked, 1)
  assert.equal(parked.rows[0].attempts, 8)
  const recovered = (await call("fire?advance=3600000")).body
  assert.equal(
    recovered.calls,
    parked.calls + 1,
    "parked callbacks retain hourly recovery"
  )
  assert.equal(recovered.closed, recovered.calls)
  receipts.push(
    "real Alchemy SQLite schedule/replacement/ack/error/interruption/bounded metadata/parking/recovery PASS"
  )
  // Sustained admitted/replayed completions keep dispatching; no quiet interval.
  const base = Date.parse("2050-01-01T00:00:00Z")
  await call("prearm?owner=traffic")
  await call("nudge?owner=traffic")
  let traffic
  for (let index = 1; index <= 240; index++) {
    traffic = (await call("traffic?owner=traffic")).body
    assert.equal(traffic.rows.length, 1)
    assert.equal(traffic.closed, traffic.calls)
    assert(
      traffic.alarm <= base + index * 500 + 1000,
      "traffic cannot postpone an earlier effective wake"
    )
    assert.equal(
      traffic.calls,
      Math.floor(index / 2),
      "callback executes DURING uninterrupted traffic"
    )
  }
  receipts.push(
    `sustained 240 nudges / 120 seconds: ${traffic.calls} callbacks during traffic PASS`
  )
  for (const kind of ["prearm-nudge", "nudge-prearm", "nudges", "nudges-reverse"]) {
    const owner = "race-" + kind
    const raced = (await call(`race?owner=${owner}&kind=${kind}`)).body
    assert.equal(raced.alarm, base + 1000, kind)
    assert.equal(raced.rows.length, 1)
    const groups = Map.groupBy(raced.transactions, (event) => event.transaction)
    assert(
      !groups.has(null),
      "every real callback SQL read/write belongs to a native transaction"
    )
    assert.equal(
      groups.size,
      2,
      "two whole check/update operations, not separate read/write transactions"
    )
    for (const events of groups.values()) {
      assert.equal(events[0].operation, "read")
      if (events.some((event) => event.operation === "write")) {
        assert(
          events.filter((event) => event.operation === "read").length >= 2,
          "status + schedule read share native transaction"
        )
      }
    }
    const replay = (await call(`nudge?owner=${owner}`)).body
    assert.equal(replay.alarm, raced.alarm)
    assert.equal(
      replay.rows[0].version,
      raced.rows[0].version,
      "replay does not replace an earlier wake"
    )
    const repeated = (await call(`race?owner=${owner}&kind=${kind}`)).body
    assert.equal(repeated.alarm, raced.alarm)
    assert.equal(repeated.rows[0].version, raced.rows[0].version)
  }
  receipts.push(
    "overlapping prearm/nudge and nudges: real native atomic check/update + earliest deadline + replay PASS"
  )
  await call("native?owner=native")
  let native
  for (let index = 0; index < 100; index++) {
    native = (await call("status?owner=native")).body
    if (native.calls > 0) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(native.calls, 1, "actual native workerd alarm must deliver")
  assert.equal(native.closed, 1)
  assert.equal(native.rows.length, 1)
  receipts.push("actual native workerd alarm delivery PASS")
  for (const [credential, data] of [
    ["invalid", { invoiceId: "invoice-a", requestId: "request-a" }],
    [
      "Bearer development-alice",
      { tenantId: "tenant-b", invoiceId: "invoice-b", requestId: "request-a" }
    ]
  ]) {
    assert.equal(
      (
        await call("issue", {
          method: "POST",
          headers: { authorization: credential },
          body: JSON.stringify(data)
        })
      ).response.status,
      403
    )
  }
  receipts.push("untrusted credential and body tenant injection rejected PASS")
  if (database) {
    const issue = (invoiceId, requestId, credential = "Bearer development-alice") =>
      call("issue?owner=pg", {
        method: "POST",
        headers: { authorization: credential },
        body: JSON.stringify({ invoiceId, requestId })
      })
    assert.equal((await issue("invoice-b", "cross-tenant")).response.status, 403)
    const first = await issue("invoice-a", "request-a")
    assert.equal(first.response.status, 200, JSON.stringify(first.body))
    const duplicate = await issue("invoice-a", "request-a")
    assert.deepEqual(duplicate.body, first.body)
    const client = createPool({
      url: database,
      connectTimeout: 2000,
      max: 1,
      reconnect: false
    })
    try {
      // The supported job sorts after twenty older, unsupported jobs on the same queue.
      const {
        rows: [scheduled]
      } = await client.query(
        `UPDATE alchemy_example.jobs
         SET available_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint + 10000
         WHERE id = $1 RETURNING available_at`,
        [first.body.jobId],
        { mode: "object" }
      )
      await client.query(
        `INSERT INTO alchemy_example.jobs
           (id, operation, operation_id, slot, queue, kind, version, policy, state, available_at, updated_at)
         SELECT 'unsupported-' || n, operation, 'unsupported-' || n, slot, queue,
                'unsupported.mail', version, policy, 'Pending', available_at - 20000, updated_at
         FROM alchemy_example.jobs CROSS JOIN generate_series(1, 20) AS n WHERE id = $1`,
        [first.body.jobId]
      )
      const idle = (await call("fire?owner=pg&mode=pg")).body
      assert.equal(idle.observed.result._tag, "Idle")
      assert.equal(idle.observed.result.claimed, 0)
      assert.equal(idle.observed.hint.nextAvailableAt, null)
      assert.equal(idle.observed.hint.nextRecoveryAt, null)
      assert.equal(idle.observed.hint.saturated, true)
      assert.equal(idle.alarm - idle.now, 5000)
      assert.equal(deliveries.size, 0)

      const early = (await call("fire?owner=pg&mode=pg&advance=1000")).body
      assert.equal(early.calls, idle.calls)
      assert.equal(early.alarm, idle.alarm)

      // The DO test clock drives alarm delivery. PostgreSQL still owns eligibility.
      await client.query(
        "SELECT pg_sleep(GREATEST(0, $1::bigint / 1000.0 - extract(epoch FROM clock_timestamp())))",
        [scheduled.available_at]
      )
      const due = (await call("fire?owner=pg&mode=pg&advance=4000")).body
      assert.equal(due.calls, idle.calls + 1)
      assert.equal(due.observed.result.claimed, 1)
      assert.equal(deliveries.size, 1)
      const { rows } = await client.query(
        "SELECT state FROM alchemy_example.jobs WHERE id = $1",
        [first.body.jobId],
        { mode: "object" }
      )
      assert.equal(rows[0].state, "Completed")
      receipts.push(
        "real PostgreSQL saturated head: five-second recheck, then claim at due time PASS"
      )
    } finally {
      await client.end()
    }
    await call("fire?owner=pg&mode=pg")
    assert.equal(deliveries.size, 1, "repeated wake cannot execute a completed job again")
    receipts.push(
      "maintained invocation real PG atomic production/receipt dedup/cross-tenant lookup and workerd bounded drain PASS"
    )
  } else {
    receipts.push(
      "real PG example integration NotTested: EXAMPLE_TEST_DATABASE_URL absent"
    )
  }
  writeFileSync(
    ".toolchain/runtime-receipt.json",
    JSON.stringify(
      {
        receipts,
        deliveries: deliveries.size,
        repeated: provider.repeated,
        hosted: "NotTested",
        networkCrash: "NotTested"
      },
      null,
      2
    )
  )
  console.log(receipts.join("\n"))
} finally {
  await mf.dispose()
}
