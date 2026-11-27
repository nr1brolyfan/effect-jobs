import { tmpdir } from "node:os"
// Public installed consumer, separate from source and optional PG evidence.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fences, jobDefinition } from "../tests/docs/readme/Visible.mjs"

const root = resolve(import.meta.dirname, "..")
assert(process.env.EFFECT_JOBS_ARCHIVE, "immutable archive required")
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
mkdirSync(join(root, ".toolchain"), { recursive: true })
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-UPVE864-public-"))
const run = (name, command, args) => {
  const output = execFileSync(command, args, {
    cwd: consumer,
    timeout: 60000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  writeFileSync(join(consumer, `${name}.log`), output)
}
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "effect-jobs": `file:${archive}`,
      effect: "4.1.3",
      typescript: "7.0.2",
      "@types/node": "26.4.1"
    }
  })
)
run("install", "npm", [
  "install",
  "--strict-peer-deps",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund"
])
run("frozen-install", "npm", [
  "ci",
  "--strict-peer-deps",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund"
])
run("tree", "npm", ["ls", "--all"])
const manifest = JSON.parse(
  readFileSync(join(consumer, "node_modules/effect-jobs/package.json"), "utf8")
)
assert.deepEqual(manifest, JSON.parse(readFileSync(join(root, "package.json"), "utf8")))
const imports = Object.keys(manifest.exports)
  .filter((key) => key !== "./PostgreSqlDrizzleSchema")
  .map((key) => (key === "." ? "effect-jobs" : `effect-jobs/${key.slice(2)}`))
writeFileSync(
  join(consumer, "inert.mjs"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
const require = createRequire(import.meta.url)
for (const peer of ["pg", "drizzle-orm", "vitest", "@effect/vitest"]) assert.throws(() => require.resolve(peer))
for (const privatePath of [
  "effect-jobs/dist/internal/JobTransaction.js",
  "effect-jobs/postgresql/PostgreSqlJobs",
  "effect-jobs/postgresql/internal/Store",
  "effect-jobs/dist/postgresql/internal/Producer.js",
  "effect-jobs/internal/postgresql/Rows"
]) {
  assert.throws(() => require.resolve(privatePath), (error) => ["ERR_PACKAGE_PATH_NOT_EXPORTED", "MODULE_NOT_FOUND"].includes(error.code))
  await assert.rejects(import(privatePath), (error) => ["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error.code))
}
const timers = { timeout: globalThis.setTimeout, interval: globalThis.setInterval }
let started = 0
const forbidden = () => { started++; throw new Error("import started a timer") }
globalThis.setTimeout = forbidden
globalThis.setInterval = forbidden
try { for (const specifier of ${JSON.stringify(imports)}) await import(specifier) }
finally { globalThis.setTimeout = timers.timeout; globalThis.setInterval = timers.interval }
assert.equal(started, 0)
console.log("all non-Drizzle public imports without optional peers: zero import timers; private deep imports rejected; PASS")
`
)
const smoke = readFileSync(
  join(root, "tests/core/codec/portable-smoke.mjs"),
  "utf8"
).replace(/"\.\.\/\.\.\/\.\.\/dist\/([^"/]+)\.js"/g, '"effect-jobs/$1"')
writeFileSync(join(consumer, "codec.mjs"), smoke)
writeFileSync(
  join(consumer, "testing.mjs"),
  readFileSync(join(root, "tests/qualification/release/Testing.mjs"))
)
writeFileSync(
  join(consumer, "worker.mjs"),
  readFileSync(join(root, "tests/qualification/release/Worker.mjs"))
)
const readme = readFileSync(join(root, "README.md"), "utf8")
const definition = fences(readme).find(([, language]) => language === "ts")
assert(definition, "README job definition required")
writeFileSync(join(consumer, "definition.mts"), jobDefinition(definition[2]))
writeFileSync(
  join(consumer, "core-exports.mts"),
  imports.map((specifier) => `import ${JSON.stringify(specifier)}`).join("\n") + "\n"
)
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: false,
      noEmit: true,
      types: ["node"]
    },
    include: ["*.mts"]
  })
)
run("docs-types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"])
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-inert`, runtime, ["inert.mjs"])
  run(`${runtime}-codec`, runtime, ["codec.mjs"])
  run(`${runtime}-testing`, runtime, ["testing.mjs"])
  run(`${runtime}-worker`, runtime, ["worker.mjs"])
}
writeFileSync(
  join(consumer, "receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      version: manifest.version,
      absentPeerExportCount: imports.length,
      docsTypecheck: "PASS skipLibCheck:false",
      testing:
        "recorder assertions and standalone delayed enqueue/drain without pg, Drizzle or Vitest Node+Bun PASS",
      worker:
        "public installed execution/scoped shutdown/span and metric privacy PASS Node+Bun",
      inertness:
        "zero timer calls; optional pg/drizzle absent; production source has no environment reads",
      codec:
        "public installed protected Union/fractional projection/roundtrip/tamper rejection Node+Bun PASS"
    },
    null,
    2
  ) + "\n"
)
console.log(`Public release consumer PASS: ${consumer}`)
