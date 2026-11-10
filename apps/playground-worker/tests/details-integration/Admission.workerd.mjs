import assert from "node:assert/strict"
import { createLocal } from "../integration/Local.mjs"
// Synthetic non-routable configuration. Denied routes must not acquire a PG client.
const cfg = {
  connectionString: "postgres://fixture:fixture@127.0.0.1:1/fixture",
  schema: "admission_fixture",
  encryptionKey: "11".repeat(32),
  fingerprintKey: "22".repeat(32),
  cursorKey: "33".repeat(32)
}
let checks = 0
for (const localPrivate of [false, true]) {
  const local = await createLocal(cfg, { https: false, localPrivate })
  try {
    for (const host of ["127.0.0.1", "localhost"]) {
      const origin = local.origin.replace("127.0.0.1", host)
      for (const path of [
        "/api/demo/jobs/repair",
        "/api/demo/jobs/resolution",
        "/api/demo/jobs/operator",
        "/api/demo",
        "/api/demo/scenarios"
      ]) {
        const response = await local.mf.dispatchFetch(origin + path, {
          method: "POST",
          headers: {
            Origin: origin,
            "X-Local-Private": "true",
            Cookie: "playground-local-credential=forged"
          },
          body: '{"trusted":true}'
        })
        assert.equal(response.status, 404)
        assert.deepEqual(await response.json(), { code: "not-found" })
        checks++
      }
      for (const path of ["/jobs", "/jobs/fixture-job?generation=1"]) {
        const response = await local.mf.dispatchFetch(origin + path, {
          headers: { "X-Local-Private": "true" }
        })
        assert.equal(response.status, localPrivate ? 200 : 404)
        if (localPrivate) {
          assert.match(await response.text(), /id="jobs"/)
        }
        checks++
      }
      if (!localPrivate) {
        for (const path of [
          "/api/sandbox/issue",
          "/api/jobs/repair",
          "/api/jobs/detail",
          "/api/changes"
        ]) {
          const response = await local.mf.dispatchFetch(origin + path, {
            method: "POST",
            headers: { Origin: origin, "X-Local-Private": "true" }
          })
          assert.equal(response.status, 404)
          checks++
        }
      }
    }
  } finally {
    await local.mf.dispose()
  }
}
console.log(
  JSON.stringify({
    result: "PASS",
    runtime: "workerd",
    checks,
    pg: "NotTested; no client acquired by these denied routes",
    cleanup: "both exact Miniflare instances disposed synchronously"
  })
)
