/** Finite app-owned migration generation proof against the immutable artifact. */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
const directory = join(root, ".toolchain/drizzle-indexes")
mkdirSync(directory, { recursive: true })
const work = mkdtempSync(join(directory, "qualified-"))
const run = (name, command, args) => {
  const result = spawnSync(command, args, {
    cwd: work,
    timeout: 60000,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  })
  writeFileSync(join(work, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""))
  assert.equal(result.status, 0, `${name} failed; retained log`)
  return result.stdout
}
writeFileSync(
  join(work, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.0.0",
        "drizzle-orm": "1.0.0-rc.5-169397b",
        "drizzle-kit": "1.0.0-rc.5-5935859"
      }
    },
    null,
    2
  ) + "\n"
)
writeFileSync(
  join(work, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" }
  }) + "\n"
)
run("install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"])
writeFileSync(
  join(work, "schema.ts"),
  `
import { sql } from "drizzle-orm"
import { index } from "drizzle-orm/pg-core"
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
const tables = makeJobTables({ schema: "indexes_fixture", extraIndexes: (jobs) => [
  index("app_jobs_by_state").on(jobs.state.asc(), jobs.id.desc()),
  index("app_jobs_pending").on(sql\`lower(\${jobs.operation})\`).where(sql\`\${jobs.state} = 'Pending'\`)
] })
export const jobs = tables.jobs
export const payloads = tables.payloads
`
)
writeFileSync(
  join(work, "drizzle.config.ts"),
  `export default { dialect: "postgresql", schema: "./schema.ts", out: "./migrations" }\n`
)
run("generate-first", "node", ["node_modules/drizzle-kit/bin.cjs", "generate"])
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)]
  )
const before = files(join(work, "migrations"))
const sqlFiles = before.filter((p) => p.endsWith(".sql"))
assert.equal(sqlFiles.length, 1)
const ddl = readFileSync(sqlFiles[0], "utf8")
for (const name of [
  "app_jobs_by_state",
  "app_jobs_pending",
  "_due",
  "_expired",
  "_terminal"
]) {
  assert(ddl.includes(name), `missing mandatory/custom index ${name}`)
}
assert(/lower\(/i.test(ddl))
assert(ddl.includes("Pending"))
assert(/desc/i.test(ddl))
const snapshots = before.filter((p) => p.endsWith("snapshot.json"))
assert.equal(snapshots.length, 1)
const snapshot = readFileSync(snapshots[0], "utf8")
for (const name of [
  "app_jobs_by_state",
  "app_jobs_pending",
  "_due",
  "_expired",
  "_terminal"
]) {
  assert(snapshot.includes(name))
}
const hashes = Object.fromEntries(
  before.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])
)
const second = run("generate-second", "node", [
  "node_modules/drizzle-kit/bin.cjs",
  "generate"
])
assert(
  /no (schema )?changes/i.test(second),
  "unchanged generation must report no changes"
)
assert.deepEqual(files(join(work, "migrations")), before)
for (const p of before) {
  assert.equal(createHash("sha256").update(readFileSync(p)).digest("hex"), hashes[p])
}
writeFileSync(
  join(work, "receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      orm: "1.0.0-rc.5-169397b",
      kit: "1.0.0-rc.5-5935859",
      customAndMandatoryDDL: true,
      snapshotRetainsCustom: true,
      repeatedGenerationNoDrop: true,
      hashes
    },
    null,
    2
  ) + "\n"
)
console.log("Drizzle custom/mandatory index DDL + snapshot + unchanged generation PASS")
