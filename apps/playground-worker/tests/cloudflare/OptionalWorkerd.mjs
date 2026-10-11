import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: readFileSync("OptionalWorker.js", "utf8"),
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    outboundService: () => new Response("Outbound denied", { status: 403 })
  })
)
try {
  const result = await (await mf.dispatchFetch("https://probe.invalid/")).json()
  assert.deepEqual(result, {
    pgClientConstructor: "function",
    nativeDrizzleFactory: "function"
  })
  console.log(
    "Local workerd optional pg/Drizzle imports PASS; database operations NotTested"
  )
} finally {
  await mf.dispose()
}
