// Packed consumer with disposable local workerd. No deployment, secrets, DB or containers.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

assert.equal(process.version, "v24.15.0")
const root = fileURLToPath(new URL("../../../../", import.meta.url))
const evidenceRoot = join(root, ".toolchain/cloudflare")
mkdirSync(evidenceRoot, { recursive: true })
const evidence = mkdtempSync(join(evidenceRoot, "run-"))
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-cloudflare-"))
const steps = []
const startedAt = Date.now()
const run = (name, command, args, cwd = consumer) => {
  const result = spawnSync(command, args, {
    cwd,
    timeout: Math.min(600_000, Math.max(1, 45 * 60_000 - (Date.now() - startedAt))),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  })
  writeFileSync(
    join(evidence, `${name}.log`),
    (result.stdout ?? "") + (result.stderr ?? "")
  )
  steps.push({ name, status: result.status, signal: result.signal })
  writeFileSync(join(evidence, "steps.json"), JSON.stringify(steps, null, 2) + "\n")
  assert.equal(result.status, 0, `${name} failed; retained evidence: ${evidence}`)
  return result.stdout
}
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const pack = JSON.parse(
  run(
    "pack",
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", evidence],
    root
  )
)[0]
assert(pack.files.every(({ path }) => !/^(apps|packages|node_modules|src)\//.test(path)))
const archive = join(evidence, pack.filename)
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.0.5",
        "@effect/sql-pg": "4.0.5",
        "drizzle-orm": "1.0.0-rc.5-169397b",
        pg: "8.23.0",
        "@types/pg": "8.20.0",
        miniflare: "5.20261006.1-alpha",
        esbuild: "0.25.12",
        typescript: "7.0.2",
        "@types/node": "26.4.1",
        "@cloudflare/workers-types": "5.20261011.1"
      }
    },
    null,
    2
  )
)
run("install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"])
run("dependency-tree", "npm", ["ls", "--all"])
copyFileSync(join(consumer, "package-lock.json"), join(evidence, "consumer-lock.json"))
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
for (const exported of Object.values(manifest.exports)) {
  assert.equal(
    hash(join(root, exported.import)),
    hash(join(consumer, "node_modules/effect-jobs", exported.import))
  )
}
for (const file of [
  "WorkerdProbe.mts",
  "Workerd.mjs",
  "CloudflareModule.d.mts",
  "OptionalWorker.mjs",
  "OptionalWorkerd.mjs"
]) {
  writeFileSync(
    join(consumer, file),
    readFileSync(
      fileURLToPath(
        new URL(file.endsWith(".mts") ? `${file}.txt` : file, import.meta.url)
      ),
      "utf8"
    ).replace("../../src/cloudflare/WakeCycle.js", "./WakeCycle.js")
  )
}
copyFileSync(
  join(root, "apps/playground-worker/src/cloudflare/WakeCycle.ts"),
  join(consumer, "WakeCycle.ts")
)
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: false,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      lib: ["ES2022", "DOM", "ESNext.Disposable"],
      types: ["node"],
      noEmit: true
    },
    include: ["WakeCycle.ts", "WorkerdProbe.mts", "CloudflareModule.d.mts"]
  })
)
// Driver optionality: separately qualify pg and native Drizzle imports on Node;
// no transaction, SQL or migration is executed by these inert imports.
writeFileSync(
  join(consumer, "Optional.mjs"),
  'import pg from "pg"\nimport * as drizzle from "drizzle-orm/effect-postgres"\nimport assert from "node:assert/strict"\nassert.equal(typeof pg.Client, "function")\nassert.equal(typeof drizzle.makeWithDefaults, "function")\nconsole.log("Node optional pg/Drizzle imports PASS; workerd compatibility remains separate")\n'
)
run("optional-node-imports", "node", ["Optional.mjs"])
run("types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], consumer)
run("bundle", join(consumer, "node_modules/.bin/esbuild"), [
  "WorkerdProbe.mts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:cloudflare:*",
  "--external:node:*",
  "--outfile=Worker.js"
])
run("workerd", "node", ["Workerd.mjs"])
run("optional-bundle", join(consumer, "node_modules/.bin/esbuild"), [
  "OptionalWorker.mjs",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:node:*",
  "--external:pg-native",
  '--banner:js=import { createRequire } from "node:module"; const require = createRequire("/worker.js");',
  "--outfile=OptionalWorker.js"
])
run("optional-workerd", "node", ["OptionalWorkerd.mjs"])
writeFileSync(
  join(evidence, "receipt.json"),
  JSON.stringify(
    {
      node: process.version,
      consumer,
      archiveSha256: hash(archive),
      bundleSha256: hash(join(consumer, "Worker.js")),
      sourceSha256: hash(join(consumer, "WakeCycle.ts")),
      probeSha256: hash(join(consumer, "WorkerdProbe.mts")),
      optionalBundleSha256: hash(join(consumer, "OptionalWorker.js")),
      harnessSha256: hash(fileURLToPath(import.meta.url)),
      workerdHarnessSha256: hash(join(consumer, "Workerd.mjs")),
      optionalHarnessSha256: hash(join(consumer, "OptionalWorkerd.mjs")),
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      postgres: "NotTested: no authorized resource",
      hosted: "NotTested: no deployment authorization",
      steps
    },
    null,
    2
  ) + "\n"
)
console.log(`Local packed/workerd evidence: ${resolve(evidence)}`)
