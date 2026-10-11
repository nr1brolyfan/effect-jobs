import { build } from "esbuild"
await build({
  entryPoints: ["src/Worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["cloudflare:*", "node:*"],
  outfile: "dist/Worker.js"
})
