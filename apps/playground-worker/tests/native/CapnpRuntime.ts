import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { build } from "esbuild"

// Bundle the exact serializer used by the installed local workerd host. This
// traverses real imports, including the upstream pregenerated schema.
const require = createRequire(import.meta.url)
const runtime = dirname(require.resolve("@alchemy.run/cloudflare-runtime/package.json"))
const serializer = join(runtime, "src/core/workerd/internal/config.serialize.ts")
const result = await build({
  entryPoints: [serializer],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  metafile: true
})
const inputs = Object.keys(result.metafile.inputs)
assert(inputs.some((path) => path.endsWith("/internal/config.capnp.ts")))
assert(inputs.some((path) => path.includes("/capnp-es/dist/")))
assert(
  !inputs.some((path) => path.includes("/compiler/") || path.includes("/typescript/"))
)
const output = result.outputFiles[0]
assert(output)
// Reject compiler/codegen imports and commands in application-owned code and
// the shipped host sources, beyond the serializer's statically bundled graph.
const inspect = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".astro", ".alchemy"].includes(entry.name)) {
      continue
    }
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await inspect(path)
    } else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name)) {
      const source = await readFile(path, "utf8")
      assert(!/capnp-es\/compiler|capnpc-(?:js|ts|dts)|capnp-es\s+-/.test(source), path)
    }
  }
}
await inspect(join(import.meta.dirname, "../../src"))
await inspect(join(runtime, "src"))
const manifest = await readFile(join(import.meta.dirname, "../../package.json"), "utf8")
assert(!/capnp-es\/compiler|capnpc-(?:js|ts|dts)|capnp-es\s+-/.test(manifest))
const schema = join(runtime, "src/core/workerd/internal/config.capnp.ts")
console.log(
  JSON.stringify(
    {
      serializer,
      schemaSha256: createHash("sha256")
        .update(await readFile(schema))
        .digest("hex"),
      bundleSha256: createHash("sha256").update(output.contents).digest("hex"),
      inputs,
      note: "Runtime graph only; the capnp-es optional TypeScript peer remains unsupported."
    },
    null,
    2
  )
)
