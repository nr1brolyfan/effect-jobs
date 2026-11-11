// Build-tool FFI for existing fixture consumers; compilation is owned by Vite.
import { build as viteBuild } from "vite"
import { resolve } from "node:path"

export const build = async (
  options: { readonly fixtures?: boolean; readonly outdir?: string } = {}
) => {
  for (const mode of options.fixtures
    ? ["production", "fixtures", "browser-test"]
    : ["production"]) {
    await viteBuild({
      root: import.meta.dirname,
      configFile: resolve(import.meta.dirname, "vite.config.ts"),
      mode,
      ...(options.outdir === undefined ? {} : { build: { outDir: options.outdir } })
    })
  }
}

if (process.argv[1] === import.meta.filename) {
  await build({
    fixtures: process.argv.includes("--fixtures"),
    ...(process.env.UI_BUILD_DIRECTORY === undefined
      ? {}
      : { outdir: resolve(process.env.UI_BUILD_DIRECTORY) })
  })
}
