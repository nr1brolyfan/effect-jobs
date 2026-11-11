import assert from "node:assert/strict"
import { test } from "vitest"
import { serve } from "./FixtureServer.js"
import { guideAssets } from "./Guide.js"
import { runQualification } from "./Runner.js"

for (const entry of [
  "site/ApiDesign",
  "site/Browser",
  "site/Routes",
  "site/JobVisuals",
  "order-tutorial/Content",
  "order-tutorial/Corrections"
]) {
  test(`${entry}: canonical built documentation, routes, browser and no-JS controls`, async () => {
    const assets = guideAssets()
    const server = await serve(async (request, response) => {
      const asset = assets(new Request(new URL(request.url ?? "/", "http://localhost")))
      response.writeHead(asset.status, Object.fromEntries(asset.headers))
      response.end(Buffer.from(await asset.arrayBuffer()))
    })
    try {
      const result = await runQualification(
        entry.replaceAll("/", "-"),
        `apps/website/tests/${entry}.ts`,
        { ...process.env, DOCS_CORRECTIONS_URL: server.origin }
      )
      assert.equal(result.exitCode, 0, result.stderr)
    } finally {
      await server.close()
    }
  })
}
