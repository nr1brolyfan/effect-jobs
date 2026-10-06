import { tmpdir } from "node:os"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Foreground, finite qualification. Keep the isolated consumer/logs for receipts.
const root = fileURLToPath(new URL("../", import.meta.url))
const resources = process.env.D6_RESOURCE_DIRECTORY
assert(resources, "D6_RESOURCE_DIRECTORY is required; skipped PG is not qualification")
const ownership = JSON.parse(readFileSync(join(resources, "ownership.json"), "utf8"))
assert(Date.now() < Date.parse(ownership.deadline) - 60000, "PG deadline reached")
mkdirSync(join(root, ".toolchain"), { recursive: true })
const directory = mkdtempSync(join(tmpdir(), "effect-jobs-UPVE864-installed-pg-"))
const run = (command, args, cwd = directory, extra = {}) => {
  const output = execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...extra },
    timeout: 60000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  process.stdout.write(output)
  return output
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE ?? "")
assert(
  process.env.EFFECT_JOBS_ARCHIVE,
  "EFFECT_JOBS_ARCHIVE must name the immutable qualified tarball"
)
const entries = run("tar", ["-tzf", archive]).trim().split("\n")
assert(
  entries.every((entry) =>
    /^package\/(dist\/|specs\/|package.json$|README.md$|CHANGELOG.md$|LICENSE$)/.test(
      entry
    )
  )
)
for (const target of Object.values(manifest.exports)) {
  for (const path of Object.values(target)) {
    assert(entries.includes(`package/${path.slice(2)}`))
  }
}
writeFileSync(
  join(directory, "package.json"),
  JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "effect-jobs": `file:${archive}`, effect: "4.0.0" }
  })
)
run("bun", ["install", "--ignore-scripts"])
// No optional peers installed: core and non-Drizzle backend imports must stay inert.
writeFileSync(
  join(directory, "imports.mjs"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
for (const peer of ["pg", "drizzle-orm"]) assert.throws(() => require.resolve(peer))
for (const subpath of ${JSON.stringify(Object.keys(manifest.exports).filter((key) => key !== "./PostgreSqlDrizzleSchema"))}) {
  await import(subpath === "." ? "effect-jobs" : "effect-jobs/" + subpath.slice(2))
}
console.log("all core/non-Drizzle public imports PASS without backend peers")
`
)
run("node", ["imports.mjs"])
run("bun", ["imports.mjs"])
run("bun", [
  "add",
  "--ignore-scripts",
  "pg@8.23.0",
  `drizzle-orm@${manifest.peerDependencies["drizzle-orm"]}`,
  "vitest@4.1.11",
  "typescript@7.0.2",
  "@types/node@26.4.1",
  "@types/pg@8.20.0"
])

// Reuse the author's unchanged real-PG oracle against packed production bytes.
// Only production imports change; runtime tests use public package exports.
for (const path of [
  "tests/qualification/Resource.mjs",
  "tests/qualification/Resource.d.mts",
  "tests/postgresql/Backend.test.ts",
  "tests/core/codec/PayloadCodec.test.ts",
  "tests/postgresql/Adapter.ts",
  "tests/qualification/d6-pg/ApplicationTransactions.ts",
  "tests/qualification/d6-pg/PgDriver.ts"
]) {
  const destination = join(directory, path)
  mkdirSync(resolve(destination, ".."), { recursive: true })
  const source = readFileSync(join(root, path), "utf8").replace(
    /"(?:\.\.\/){2,3}src\/([^"/]+)\.js"/g,
    '"effect-jobs/$1"'
  )
  writeFileSync(destination, source)
}
symlinkSync(
  join(directory, "node_modules"),
  join(directory, "tests/postgresql/node_modules"),
  "dir"
)
writeFileSync(
  join(directory, "vitest.config.ts"),
  `import { defineConfig } from "vitest/config"
export default defineConfig({ test: { include: ["tests/postgresql/Backend.test.ts", "tests/core/codec/PayloadCodec.test.ts"] } })\n`
)
writeFileSync(
  join(directory, "types.ts"),
  `
import { Effect, Layer } from "effect"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Tables from "effect-jobs/PostgreSqlSchema"
import { PostgreSqlApplication, type ApplicationAdapter } from "effect-jobs/PostgreSqlTransaction"
declare const adapter: ApplicationAdapter
const mapping = Tables.tables({ schema: "installed", jobsTable: "tasks", payloadsTable: "artifacts" })
const program: Effect.Effect<Jobs.Backend, Tables.PostgreSqlConfigurationError> = Jobs.make({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
const layer = Jobs.layerNoDeps({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(Layer.provide(Layer.succeed(PostgreSqlApplication, adapter)))
void program; void layer
`
)
writeFileSync(
  join(directory, "tsconfig.json"),
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
    include: ["types.ts"]
  })
)
run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"])
// Match the repository's Drizzle consumer setting. This does not qualify
// upstream Drizzle declarations with skipLibCheck:false. Keep strict full
// declaration checking above for the non-Drizzle backend.
writeFileSync(
  join(directory, "drizzle-types.ts"),
  `
import * as Drizzle from "effect-jobs/PostgreSqlDrizzleSchema"
import { getTableConfig } from "drizzle-orm/pg-core"
const config = getTableConfig(Drizzle.makeJobTables({ schema: "installed" }).jobs)
void config
`
)
writeFileSync(
  join(directory, "tsconfig.drizzle.json"),
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { skipLibCheck: true },
    include: ["drizzle-types.ts"]
  })
)
run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.drizzle.json"])
writeFileSync(
  join(directory, "drizzle-import.mjs"),
  `
import assert from "node:assert/strict"
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
import { getTableConfig } from "drizzle-orm/pg-core"
const tables = makeJobTables({ schema: "installed", jobsTable: "tasks", payloadsTable: "artifacts" })
const jobs = getTableConfig(tables.jobs)
const payloads = getTableConfig(tables.payloads)
assert.equal(jobs.schema, "installed")
assert.equal(jobs.name, "tasks")
assert.equal(payloads.name, "artifacts")
assert.equal(payloads.foreignKeys.length, 1)
assert.equal(jobs.indexes.length, 3)
console.log("installed Drizzle mapping/constraints PASS")
`
)
run("node", ["drizzle-import.mjs"])
run("bun", ["drizzle-import.mjs"])
for (const runtime of ["node", "bun"]) {
  const evidence = join(directory, `${runtime}-pg-evidence.json`)
  run(
    runtime,
    [...(runtime === "bun" ? ["--bun"] : []), "node_modules/vitest/vitest.mjs", "run"],
    directory,
    {
      PG_EXPECT_RUNTIME: runtime,
      PG_EVIDENCE_FILE: evidence
    }
  )
  const receipt = JSON.parse(readFileSync(evidence, "utf8"))
  assert.equal(receipt.runtime, runtime)
  assert.equal(receipt.ddl, 0)
  assert.equal(receipt.savepoints, 0)
}
console.log(`Installed PostgreSQL qualification PASS; consumer/receipts: ${directory}`)
