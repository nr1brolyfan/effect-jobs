import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { releaseImports } from "./release-imports.mjs"

assert(process.env.EFFECT_JOBS_ARCHIVE, "EFFECT_JOBS_ARCHIVE is required")
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
const run = (command, args) =>
  execFileSync(command, args, { timeout: 60000, encoding: "utf8" })
const entries = run("tar", ["-tzf", archive]).trim().split("\n")
assert(
  entries.every((entry) =>
    /^package\/(dist\/|specs\/|package.json$|README.md$|CHANGELOG.md$|LICENSE$)/.test(
      entry
    )
  )
)
const manifest = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"]))
assert.deepEqual(
  manifest,
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")),
  "Archive manifest must match final repository metadata"
)
assert.equal(manifest.name, "effect-jobs")
assert.equal(manifest.private, false)
assert.match(manifest.version, /^\d+\.\d+\.\d+-alpha\.\d+$/)
assert.deepEqual(manifest.publishConfig, {
  access: "public",
  registry: "https://registry.npmjs.org",
  tag: "alpha"
})
assert(
  Object.keys(manifest.scripts).every(
    (key) =>
      ![
        "preinstall",
        "install",
        "postinstall",
        "prepare",
        "prepublish",
        "prepublishOnly",
        "prepack",
        "postpack",
        "publish",
        "postpublish"
      ].includes(key)
  ),
  "Consumer/publish lifecycle scripts must be absent"
)
assert(!manifest.dependencies?.["effect-auth-core"])
for (const target of Object.values(manifest.exports)) {
  for (const path of Object.values(target))
    assert(entries.includes(`package/${path.slice(2)}`))
}
const graph = { javascriptFiles: 0, declarationFiles: 0, externalImports: new Set() }
const sources = entries
  .filter((entry) => /\.(js|d\.ts)$/.test(entry))
  .map((entry) => ({ filename: entry, source: run("tar", ["-xOf", archive, entry]) }))
const importsByFile = new Map(
  releaseImports(sources).map(({ filename, imports }) => [filename, imports])
)
for (const { filename: entry, source } of sources) {
  if (entry.endsWith(".js")) {
    graph.javascriptFiles++
  } else {
    graph.declarationFiles++
  }
  assert(!/effect-auth/.test(source), `Private auth dependency in ${entry}`)
  for (const specifier of importsByFile.get(entry)) {
    if (!specifier.startsWith(".")) {
      assert(
        /^(effect(?:\/|$)|node:|drizzle-orm(?:\/|$))/.test(specifier),
        `Unexpected dependency ${specifier}`
      )
      graph.externalImports.add(specifier)
    }
  }
  if (entry.endsWith(".js")) {
    assert(!/process\.env/.test(source), `Environment access in ${entry}`)
  }
}
const dryRun = JSON.parse(
  run("npm", [
    "publish",
    archive,
    "--dry-run",
    "--ignore-scripts",
    "--tag",
    "alpha",
    "--access",
    "public",
    "--registry",
    "https://registry.npmjs.org",
    "--json"
  ])
)
console.log(
  JSON.stringify(
    {
      version: manifest.version,
      fileCount: entries.length,
      sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      graph: { ...graph, externalImports: [...graph.externalImports].sort() },
      dryRun
    },
    null,
    2
  )
)
