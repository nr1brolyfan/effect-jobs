import {
  checkDevelopmentPin,
  drizzleSource,
  drizzleVersion,
  checkInstalledGraph,
  effectVersion
} from "../DrizzleSnapshot.mjs"
/** Finite app-owned migration generation proof against the immutable artifact. */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
checkDevelopmentPin(JSON.parse(readFileSync(join(root, "package.json"), "utf8")))
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
const kitVersion = "1.0.0-rc.6"
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
        effect: effectVersion,
        "drizzle-orm": drizzleSource,
        "drizzle-kit": kitVersion
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
const resolvedGraph = checkInstalledGraph(work, {
  "drizzle-kit": kitVersion
})
writeFileSync(
  join(work, "schema.ts"),
  `
import { sql } from "drizzle-orm"
import { index } from "drizzle-orm/pg-core"
import { makeAttemptHistoryTable, makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
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
const kit = join(work, "node_modules/.bin/drizzle-kit")
run("generate-first", kit, ["generate"])
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
const second = run("generate-second", kit, ["generate"])
assert(
  /no (schema )?changes/i.test(second),
  "unchanged generation must report no changes"
)
assert.deepEqual(files(join(work, "migrations")), before)
for (const p of before) {
  assert.equal(createHash("sha256").update(readFileSync(p)).digest("hex"), hashes[p])
}
appendFileSync(
  join(work, "schema.ts"),
  "export const attemptHistory = makeAttemptHistoryTable(tables)\n"
)
run("generate-history", kit, ["generate"])
const added = files(join(work, "migrations")).filter((p) => !before.includes(p))
const historyMigrations = added.filter((p) => p.endsWith(".sql"))
assert.equal(historyMigrations.length, 1)
const historyDdl = readFileSync(historyMigrations[0], "utf8")
assert.match(historyDdl, /CREATE TABLE "indexes_fixture"\."[^"]+_attempts"/i)
assert.match(
  historyDdl,
  /REFERENCES "indexes_fixture"\."jobs"\s*\("id"\) ON DELETE CASCADE/i
)
assert.match(historyDdl, /PRIMARY KEY\("job_id","lifecycle_version"\)/i)
assert.match(historyDdl, /CREATE INDEX "[^"]+_attempt_exp"/i)
assert.doesNotMatch(
  historyDdl,
  /(?:ALTER TABLE|DROP TABLE|CREATE TABLE) "indexes_fixture"\."(?:jobs|job_payloads)"/i
)
for (const p of before) {
  assert.equal(createHash("sha256").update(readFileSync(p)).digest("hex"), hashes[p])
}
const recorded = files(join(work, "migrations"))
const unchangedHistory = run("generate-history-unchanged", kit, ["generate"])
assert.match(unchangedHistory, /no (schema )?changes/i)
assert.deepEqual(files(join(work, "migrations")), recorded)

writeFileSync(
  join(work, "receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      orm: drizzleVersion,
      resolvedGraph,
      kit: kitVersion,
      customAndMandatoryDDL: true,
      snapshotRetainsCustom: true,
      repeatedGenerationNoDrop: true,
      hashes,
      historyMigration: {
        sha256: createHash("sha256").update(historyDdl).digest("hex"),
        additive: true,
        repeatedGenerationNoDrop: true
      }
    },
    null,
    2
  ) + "\n"
)
console.log("Drizzle custom/mandatory index DDL + snapshot + unchanged generation PASS")
