import assert from "node:assert/strict"
import { resolve } from "node:path"
const { createAssets } = (await import(
  new URL("../../../playground-worker/src/assets/StaticAssets.ts", import.meta.url).href
)) as typeof import("../../../playground-worker/src/assets/StaticAssets.js")

export const guideAssets = () => {
  const fetch = createAssets({
    siteDirectory: resolve("apps/website/dist/site"),
    dashboard: {}
  })
  const alias = fetch(new Request("http://localhost/docs/jobs"))
  assert.equal(alias.status, 200, "Build the canonical website before guide consumers")
  return fetch
}
