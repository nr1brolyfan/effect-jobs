import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: readFileSync("Worker.js", "utf8"),
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
    durableObjectsPersist: false,
    // Reject all outgoing HTTP calls. The probe performs no PostgreSQL queries.
    outboundService: () => new Response("Outbound denied", { status: 403 })
  })
)
try {
  const native = await (await mf.dispatchFetch("https://probe.invalid/native")).json()
  assert.deepEqual(native, {
    noActive: "transaction-required",
    commitKnowledge: "NotCommitted"
  })
  const wake = await (await mf.dispatchFetch("https://probe.invalid/wake")).json()
  assert.deepEqual(wake, {
    result: { _tag: "Idle", claimed: 0, recovered: 0 },
    alarmSet: true
  })
  console.log(
    JSON.stringify({
      runtime: "local-workerd",
      native,
      wake,
      postgres: "NotTested",
      hosted: "NotTested"
    })
  )
} finally {
  await mf.dispose()
}
