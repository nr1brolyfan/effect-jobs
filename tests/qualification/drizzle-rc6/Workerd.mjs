import assert from "node:assert/strict"
import { build } from "esbuild"
import { setTimeout } from "node:timers/promises"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"

const bundle = await build({
  entryPoints: ["Worker.mjs"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "import"],
  mainFields: ["module", "main"],
  external: ["cloudflare:*", "node:*"],
  write: false,
  metafile: true
})
assert(
  Object.keys(bundle.metafile.inputs).some((path) => path.endsWith("/effect/cf.js")),
  "Worker must bundle the CF driver transport"
)
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    hyperdrives: { DB: process.env.PROBE_URL },
    bindings: { DRIVER_VERSION: process.env.DRIVER_VERSION },
    durableObjects: { COORDINATOR: { className: "Probe", useSQLite: true } },
    durableObjectsPersist: false
  })
)
try {
  const res = await mf.dispatchFetch("https://probe.invalid/produce")
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "produced")
  let status
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await mf.dispatchFetch("https://probe.invalid/status")
    assert.equal(response.status, 200)
    status = await response.text()
    if (status === "drained") {
      break
    }
    await setTimeout(100)
  }
  assert.equal(
    status,
    "drained",
    "native alarm delivered and finalized jobs in PostgreSQL"
  )
} finally {
  await mf.dispose()
}
