import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { makeDevelopmentProvider } from "./DevelopmentProvider.mjs"
const database = process.env.EXAMPLE_TEST_DATABASE_URL
const manifest = JSON.parse(readFileSync(".toolchain/full-app-entry.json", "utf8"))
const provider = makeDevelopmentProvider()
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: manifest.files.map((path) => ({
      type: "ESModule",
      path: resolve(".toolchain/full-app", path)
    })),
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      BillingCoordinator: { className: "BillingCoordinator", useSQLite: true }
    },
    durableObjectsPersist: false,
    hyperdrives: {
      JobsPostgres: database ?? "postgres://unused:unused@127.0.0.1:5432/unused"
    },
    bindings: {
      EXAMPLE_DATABASE_URL: database ?? "postgres://unused:unused@127.0.0.1:5432/unused",
      EXAMPLE_PROVIDER_URL: "https://provider.invalid/deliver"
    },
    outboundService: (request) => {
      assert.equal(new URL(request.url).hostname, "provider.invalid")
      return provider.accept(request)
    }
  })
)
const issue = (body, credential = "Bearer development-alice") =>
  mf.dispatchFetch("https://example.invalid/issue", {
    method: "POST",
    headers: { authorization: credential, "content-type": "application/json" },
    body: JSON.stringify(body)
  })
try {
  assert.equal((await issue({}, "invalid")).status, 403)
  assert.equal(
    (await issue({ tenantId: "tenant-b", invoiceId: "invoice-b", requestId: "full-app" }))
      .status,
    400
  )
  if (database) {
    assert.equal(
      (await issue({ invoiceId: "invoice-b", requestId: "full-cross" })).status,
      403
    )
    assert.equal(
      (await issue({ invoiceId: "invoice-reject", requestId: "rollback-request" }))
        .status,
      503
    )
    const request = { invoiceId: "invoice-a", requestId: "full-app" }
    const first = await issue(request)
    assert.equal(first.status, 200)
    const value = await first.json()
    const duplicate = await issue(request)
    assert.equal(duplicate.status, 200)
    assert.deepEqual(await duplicate.json(), value)
    for (let index = 0; index < 150 && provider.effects.size === 0; index++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(
      provider.effects.size,
      1,
      "real maintained Worker -> DO callback -> PG drain -> idempotent provider"
    )
    assert(provider.effects.has(value.jobId))
    console.log(
      "complete maintained Alchemy Worker/DO layers, Hyperdrive invocation, atomic receipt replay, native callback PG drain and provider PASS"
    )
  } else {
    console.log(
      "complete maintained Alchemy native Worker/DO bootstrap and admission PASS; PG NotTested"
    )
  }
} finally {
  await mf.dispose()
}
