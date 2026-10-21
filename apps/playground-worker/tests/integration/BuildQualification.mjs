import { build } from "esbuild"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
const directory = resolve(process.env.D6_RESOURCE_DIRECTORY)
mkdirSync(directory, { recursive: true })
for (const name of ["RepairPg", "RepairHistorical", "SchemaEntry"]) {
  await build({
    entryPoints: [`apps/playground-worker/tests/integration/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["node:*", "effect", "effect/*", "effect-jobs/*"],
    outfile: `${directory}/${name === "SchemaEntry" ? "Migrations" : name}.mjs`
  })
}
const paths = [
  "apps/playground-worker/dist/Worker.js",
  "apps/website/dist/Client.js",
  "apps/website/dist/Jobs.css",
  ...["RepairPg", "RepairHistorical", "Migrations"].map(
    (name) => `${directory}/${name}.mjs`
  )
]
writeFileSync(
  `${directory}/artifacts.json`,
  JSON.stringify(
    Object.fromEntries(
      paths.map((path) => [
        path,
        createHash("sha256").update(readFileSync(path)).digest("hex")
      ])
    ),
    null,
    2
  )
)
