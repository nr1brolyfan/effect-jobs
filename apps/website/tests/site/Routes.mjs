// Workerd HTTP routing with synthetic configuration; no database connection is used.
import assert from "node:assert/strict"
import { createLocal } from "../../../playground-worker/tests/integration/Local.mjs"

const key = Buffer.alloc(32, 7).toString("base64")
const local = await createLocal(
  {
    connectionString: "postgres://synthetic:synthetic@127.0.0.1:1/synthetic",
    schema: "synthetic_docs_routes",
    encryptionKey: key,
    fingerprintKey: key,
    cursorKey: key
  },
  { https: false }
)
try {
  const docs = await local.mf.dispatchFetch(local.origin + "/docs")
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /Durable jobs, explicit ownership/)
  for (const path of [
    "/jobs",
    "/jobs/private",
    "/api/jobs",
    "/api/demo/operator",
    "/api/demo/unknown",
    "/.env"
  ]) {
    const result = await local.mf.dispatchFetch(local.origin + path)
    assert.equal(result.status, 404, path)
  }
  const mutation = await local.mf.dispatchFetch(local.origin + "/api/demo/jobs", {
    method: "POST"
  })
  assert.equal(mutation.status, 404)
  console.log(
    "PASS: actual workerd /docs without DB; hosted private routes and demo mutations denied"
  )
} finally {
  await local.mf.dispose()
}
