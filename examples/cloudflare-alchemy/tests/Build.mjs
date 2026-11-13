// @effect-diagnostics unstableApiUsage:off
// Test-only bundling provides the pinned Effect 4.1.0 Node platform services.
import { build } from "esbuild"
import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
const require = createRequire(import.meta.url)
const cf = resolve(dirname(require.resolve("@alchemy.run/cloudflare")), "..")
mkdirSync(".toolchain", { recursive: true })
// Bundle actual installed callback/storage code. Internal imports are confined to tests.
const runtimeOptions = {
  entryPoints: ["tests/Workerd.mts.txt"],
  outfile: ".toolchain/worker.mjs",
  loader: { ".txt": "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  conditions: ["worker"],
  mainFields: ["module", "main"],
  external: ["cloudflare:*", "node:*", "react-devtools-core"],
  define: { "globalThis.__ALCHEMY_RUNTIME__": "true" },
  alias: {
    "alchemy-test/AlarmCallback": resolve(cf, "src/Workers/AlarmCallback.ts"),
    "alchemy-test/WorkerBridge": resolve(cf, "src/Workers/WorkerBridge.ts"),
    "alchemy-test/DurableObjectBridge": resolve(cf, "src/Workers/DurableObjectBridge.ts"),
    "alchemy-test/WorkerRuntimeContext": resolve(
      cf,
      "src/Workers/WorkerRuntimeContext.ts"
    ),
    "alchemy-test/DurableObjectState": resolve(cf, "src/Workers/DurableObjectState.ts")
  }
}
await build(runtimeOptions)
// Exercise the same Cloudflare bundler pipeline as Alchemy's Worker provider,
// including nodejs_compat plugins; the generic Node bundler leaves createRequire
// in the Worker runtime. Both fixture directories are siblings of src/, so the
// generated .mts entry preserves the original fixture bytes and relative imports.
const fullAppEntry = resolve(".toolchain/FullApp.mts")
writeFileSync(fullAppEntry, readFileSync("tests/FullApp.mts.txt"))
const applicationBundle = await Effect.runPromise(
  Effect.gen(function* () {
    const bundler = yield* WorkerBundle
    return yield* bundler.build({
      id: "InvoiceApplication",
      main: fullAppEntry,
      compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] },
      entry: { kind: "external" },
      stack: { name: "JobsExample", stage: "test" },
      extraOptions: {
        input: { resolve: { alias: runtimeOptions.alias } },
        output: {
          dir: resolve(".toolchain/full-app"),
          format: "esm",
          sourcemap: false,
          entryFileNames: "[name].mjs",
          chunkFileNames: "[name]-[hash].mjs"
        }
      }
    })
  }).pipe(Effect.provide(NodeServices.layer))
)

writeFileSync(
  ".toolchain/full-app-entry.json",
  JSON.stringify({
    entry: resolve(".toolchain/full-app", applicationBundle.files[0].path),
    files: applicationBundle.files.map((file) => file.path)
  })
)

// Build the maintained application/stack without evaluating an infrastructure program.
await build({
  entryPoints: ["alchemy.run.ts"],
  outfile: ".toolchain/stack.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "es2022"
})

await build({
  entryPoints: ["tests/Policy.ts", "tests/Cleanup.ts"],
  outdir: ".toolchain",
  entryNames: "[name]",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "es2022"
})
