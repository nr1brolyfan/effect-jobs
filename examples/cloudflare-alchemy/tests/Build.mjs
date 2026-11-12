import { build } from "esbuild"
import * as Bundle from "alchemy/Bundle"
import { Effect } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
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
// Use Alchemy's own runtime bundler/pure annotations for the complete native
// entrypoint. Plain esbuild retains plan-only LocalRuntime module side effects.
const applicationBundle = await Effect.runPromise(
  Bundle.build(
    {
      input: "tests/FullApp.mts.txt",
      moduleTypes: { ".txt": "ts" },
      platform: "node",
      external: (id) =>
        id.startsWith("cloudflare:") ||
        id.startsWith("node:") ||
        id === "react-devtools-core",
      resolve: {
        conditionNames: ["worker", "module", "default"],
        alias: runtimeOptions.alias
      }
    },
    {
      dir: ".toolchain/full-app",
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs"
    }
  )
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
