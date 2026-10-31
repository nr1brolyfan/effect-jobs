// Normal npm-installed artifact consumer; strict checking stays enabled.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
const out = resolve(root, ".toolchain/creation-time")
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
mkdirSync(out, { recursive: true })
const work = mkdtempSync(join(out, "installed-"))
const gates = []
const run = (label, command, args) => {
  const result = spawnSync(command, args, {
    cwd: work,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024
  })
  writeFileSync(join(work, label + ".log"), (result.stdout ?? "") + (result.stderr ?? ""))
  gates.push({ label, command: [command, ...args], exit: result.status })
  return result.status
}
writeFileSync(
  join(work, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.1.0",
        "drizzle-orm": "1.0.0-rc.5",
        typescript: "7.0.2",
        "@types/node": "26.4.1"
      }
    },
    null,
    2
  ) + "\n"
)
assert.equal(
  run("install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]),
  0
)
writeFileSync(
  join(work, "Consumer.mts"),
  `
import assert from "node:assert/strict"
import { Schema } from "effect"
import { JobSnapshot, type JobSnapshot as Snapshot } from "effect-jobs/JobLifecycle"
import * as Storage from "effect-jobs/PostgreSqlSchema"
import { defaultPolicy } from "effect-jobs/JobPolicy"
declare const snapshot: Snapshot
export const creation = (s: Snapshot): number | null | undefined => s.createdAt
const base = { jobId: "installed", policy: defaultPolicy, state: "Pending", availableAt: 9000, updatedAt: 500,
  attemptsMade: 0, stalledCount: 0, lifecycleVersion: 0, leaseToken: null, leaseExpiresAt: null, completedAt: null, lastFailureCode: null }
for (const createdAt of [null, 500]) {
  const row = Schema.decodeUnknownSync(JobSnapshot)({ ...base, createdAt })
  assert.equal(creation(row), createdAt)
}
assert(Schema.is(JobSnapshot)(base))
assert.equal(Storage.creationTimeMigration(Storage.tables({ schema: "billing", jobsTable: "tasks" })),
  'ALTER TABLE "billing"."tasks" ADD COLUMN created_at bigint;')
assert(Storage.migration().includes("created_at bigint,"))
console.log("installed creation schema/types/mapped migration PASS")
`
)
writeFileSync(
  join(work, "Drizzle.mts"),
  `
import assert from "node:assert/strict"
import { getTableConfig, index } from "drizzle-orm/pg-core"
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
const tables = makeJobTables({ extraIndexes: (j) => [index("by_creation").on(j.createdAt)] })
const column = getTableConfig(tables.jobs).columns.find((c) => c.name === "created_at")!
assert.equal(column.notNull, false)
assert.equal(column.hasDefault, false)
assert.equal(column.getSQLType(), "bigint")
console.log("installed Drizzle creation metadata PASS")
`
)
const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: false,
  types: ["node"],
  outDir: "compiled"
}
writeFileSync(
  join(work, "tsconfig.json"),
  JSON.stringify({ compilerOptions, include: ["Consumer.mts"] }, null, 2)
)
assert.equal(
  run("strict-core", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]),
  0
)
for (const runtime of ["node", "bun"]) {
  assert.equal(run(runtime + "-core-runtime", runtime, ["compiled/Consumer.mjs"]), 0)
  assert.equal(run(runtime + "-drizzle-runtime", runtime, ["Drizzle.mts"]), 0)
}
writeFileSync(
  join(work, "tsconfig.drizzle.json"),
  JSON.stringify(
    {
      compilerOptions: { ...compilerOptions, skipLibCheck: true, noEmit: true },
      include: ["Drizzle.mts"]
    },
    null,
    2
  )
)
const drizzleExit = run("drizzle-consumer", "node", [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.drizzle.json"
])
assert.equal(drizzleExit, 0)
// Keep the complete foreign-declaration audit separate from the normal consumer
// gate. Its raw result is diagnostic, never rewritten into a strict PASS.
const foreignExit = run("foreign-drizzle", "node", [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.drizzle.json",
  "--skipLibCheck",
  "false"
])
writeFileSync(
  join(out, "installed-receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      work,
      gates,
      strictCore: "PASS",
      drizzleConsumer: "PASS (skipLibCheck:true)",
      foreignDeclarations:
        foreignExit === 0
          ? "PASS"
          : "FAIL: retained upstream strict declaration errors; no suppression"
    },
    null,
    2
  ) + "\n"
)
console.log(
  JSON.stringify({
    strictCore: "PASS",
    drizzleConsumer: "PASS",
    foreignDeclarationExit: foreignExit,
    work
  })
)
