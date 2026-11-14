// The same beta.85 source provider used by Website.Astro. Node is required by
// the existing StyleX media-query parser; no cloud access or deployment occurs.
import source from "@alchemy.run/frontend-frameworks/astro/source"
import { PlatformServices } from "alchemy/Util/PlatformServices"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const rootDir = fileURLToPath(new URL("../", import.meta.url))
const output = await Effect.runPromise(
  Effect.gen(function* () {
    const provider = yield* source.make({
      rootDir,
      astro: { output: "static", outDir: "./dist/hosting" },
      sessionKVBindingName: false,
      prerenderEnvironment: "node"
    })
    return yield* provider.build({
      id: "Docs",
      workerName: "effect-jobs-docs-production",
      compatibility: { date: "2026-10-13", flags: ["nodejs_compat"] },
      stack: { name: "EffectJobsDocs", stage: "production" },
      env: undefined,
      assets: { htmlHandling: "drop-trailing-slash", notFoundHandling: "404-page" }
    })
  }).pipe(Effect.provide(PlatformServices))
)
assert.equal(output.bundle, undefined, "Static docs must upload no runtime")
assert.ok(output.assets)
assert.ok(Object.keys(output.assets.manifest).includes("/index.html"))
await writeFile(
  new URL("../dist/hosting-build.json", import.meta.url),
  JSON.stringify(
    {
      provider: "@alchemy.run/frontend-frameworks/astro/source@2.0.0-beta.85",
      runtime: process.version,
      assetsOnly: output.bundle === undefined,
      directory: output.assets.directory,
      assets: output.assets.manifest,
      hash: output.hash
    },
    null,
    2
  ) + "\n"
)
console.log("PASS: native Astro build contains assets only; no uploaded runtime")
