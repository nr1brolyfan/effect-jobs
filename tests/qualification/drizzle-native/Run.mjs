import { selectSnapshot, checkInstalledGraph } from "../DrizzleSnapshot.mjs"
import { tmpdir } from "node:os"
// Finite packed-consumer gate. Owns only ignored scratch files, never root pins.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  unlinkSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
assert.equal(process.version, "v24.15.0")
assert(process.env.D6_RESOURCE_DIRECTORY, "private PG resources required")
mkdirSync(join(root, ".toolchain"), { recursive: true })
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-UPVE864-native-"))
const run = (
  name,
  command,
  args,
  cwd = consumer,
  extra = {},
  expectedFailure = false
) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extra },
    timeout: 60000,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  })
  writeFileSync(
    join(consumer, `${name}.log`),
    (result.stdout ?? "") + (result.stderr ?? "")
  )
  if (!expectedFailure) {
    assert.equal(result.status, 0, `${name} failed; see its retained log`)
  }
  return result.status
}
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
assert(
  process.env.EFFECT_JOBS_ARCHIVE,
  "EFFECT_JOBS_ARCHIVE must name the immutable qualified tarball"
)
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
copyFileSync(
  join(root, "tests/qualification/Resource.mjs"),
  join(consumer, "Resource.mjs")
)
copyFileSync(
  join(root, "tests/qualification/Resource.d.mts"),
  join(consumer, "Resource.d.mts")
)
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const drizzleVersion = selectSnapshot(manifest)
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.1.0",
        "drizzle-orm": drizzleVersion,
        "@effect/sql-pg": "4.1.0",
        pg: "8.23.0",
        "@types/pg": "8.20.0",
        "@types/node": "26.4.1",
        typescript: "7.0.2"
      }
    },
    null,
    2
  ) + "\n"
)
// npm uses its normal strict peer resolver. No force or legacy-peer-deps.
run("npm-install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"])
run("npm-tree", "npm", ["ls", "--all"])
const resolvedGraph = checkInstalledGraph(consumer, drizzleVersion, {
  "@effect/sql-pg": "4.1.0",
  pg: "8.23.0",
  typescript: "7.0.2",
  "@types/node": "26.4.1",
  "@types/pg": "8.20.0"
})
// Resolve optional native fixture types for repository lint after a fresh
// checkout, without installing into or editing the root package.
if (drizzleVersion === manifest.devDependencies["drizzle-orm"]) {
  const fixtureModules = fileURLToPath(new URL("node_modules", import.meta.url))
  mkdirSync(fixtureModules, { recursive: true })
  for (const entry of readdirSync(join(consumer, "node_modules"))) {
    const target = join(fixtureModules, entry)
    if (
      existsSync(target) ||
      (() => {
        try {
          return lstatSync(target).isSymbolicLink()
        } catch {
          return false
        }
      })()
    ) {
      assert(
        lstatSync(target).isSymbolicLink(),
        "Never replace caller-owned fixture modules"
      )
      unlinkSync(target)
    }
    symlinkSync(join(consumer, "node_modules", entry), target)
  }
}

for (const file of [
  "NativeApplication.mts",
  "NativeQualification.mts",
  "NativeAmbient.mts"
]) {
  writeFileSync(
    join(consumer, file),
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").replace(
      '"../Resource.mjs"',
      '"./Resource.mjs"'
    )
  )
}
// Negative contract code is a fixture template (like docs fixtures); it is compiled
// with real strict TypeScript here, including its intentionally missing Context.
writeFileSync(
  join(consumer, "ContractProbes.mts"),
  readFileSync(fileURLToPath(new URL("ContractProbes.mts.txt", import.meta.url)), "utf8")
)
writeFileSync(
  join(consumer, "PublicExports.mts"),
  Object.keys(manifest.exports)
    .map(
      (path, i) =>
        `import * as Export${i} from ${JSON.stringify(path === "." ? "effect-jobs" : `effect-jobs/${path.slice(2)}`)}\nvoid Export${i}`
    )
    .join("\n") + "\n"
)
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        types: ["node"],
        outDir: "compiled"
      },
      include: ["*.mts"]
    },
    null,
    2
  ) + "\n"
)
run("consumer-types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"])
copyFileSync(join(consumer, "Resource.mjs"), join(consumer, "compiled/Resource.mjs"))
// Audit the actual current declarations. Historical snapshot exceptions do not
// transfer to a different release; retain A+B/runtime results independently.
const upstreamExit = run(
  "foreign-declarations-current",
  "node",
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.json",
    "--skipLibCheck",
    "false",
    "--noEmit"
  ],
  consumer,
  {},
  true
)
assert.notEqual(upstreamExit, null, "Foreign declaration audit must execute")
const upstreamAudit = {
  status: upstreamExit === 0 ? "PASS" : "FAIL (unwaived)",
  exitCode: upstreamExit,
  blocking: upstreamExit !== 0,
  scope: "Current packed native consumer with skipLibCheck:false",
  drizzle: drizzleVersion,
  logSha256: sha256(join(consumer, "foreign-declarations-current.log"))
}
// Unsuppress ONLY the deliberate negative source probes and verify each actual diagnostic.
const probes = readFileSync(join(consumer, "ContractProbes.mts"), "utf8")
const negative = probes
  .split("\n")
  .filter((line) => !line.includes("@ts-expect-error"))
  .join("\n")
writeFileSync(join(consumer, "Negative.mts"), negative)
writeFileSync(
  join(consumer, "tsconfig.negative.json"),
  JSON.stringify({
    extends: "./tsconfig.json",
    include: ["Negative.mts"],
    compilerOptions: { noEmit: true }
  })
)
assert.equal(
  run(
    "negative-contracts",
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "tsconfig.negative.json",
      "--pretty",
      "false"
    ],
    consumer,
    {},
    true
  ),
  1
)
const diagnostics = [
  ...readFileSync(join(consumer, "negative-contracts.log"), "utf8").matchAll(
    /Negative.mts\((\d+),\d+\): error (TS\d+):/g
  )
]
assert.equal(diagnostics.length, 6)
const oracleNames = [
  "badQueryError",
  "badTransactionError",
  "badJoinedError",
  "badOutput",
  "missingCaller",
  "values({ id:"
]
for (const [i, diagnostic] of diagnostics.entries()) {
  assert(negative.split("\n")[Number(diagnostic[1]) - 1].includes(oracleNames[i]))
}
const effectPaths = Object.keys(
  JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8")).packages
).filter((path) => path.endsWith("node_modules/effect"))
assert.deepEqual(effectPaths, ["node_modules/effect"])
const receipts = []
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-exports`, runtime, ["compiled/PublicExports.mjs"])
  const evidence = join(consumer, `${runtime}-evidence.json`)
  run(`${runtime}-native`, runtime, ["compiled/NativeQualification.mjs"], consumer, {
    NATIVE_EVIDENCE_FILE: evidence
  })
  const receipt = JSON.parse(readFileSync(evidence, "utf8"))
  assert.equal(receipt.drizzle, drizzleVersion)
  assert.equal(receipt.runtime, runtime)
  assert.equal(receipt.runtimeVersion, runtime === "node" ? "v24.15.0" : "1.4.2")
  assert.equal(receipt.success, true)
  assert.deepEqual(receipt.cleanup, { schemas: 0, roles: 0 })
  const ambientEvidence = join(consumer, `${runtime}-ambient-evidence.json`)
  run(`${runtime}-ambient`, runtime, ["compiled/NativeAmbient.mjs"], consumer, {
    AMBIENT_EVIDENCE_FILE: ambientEvidence
  })
  const ambient = JSON.parse(readFileSync(ambientEvidence, "utf8"))
  assert.equal(ambient.success, true)
  assert.equal(ambient.runtime, runtime)
  receipts.push({ ...receipt, ambient })
}
const receipt = {
  archiveSha256: sha256(archive),
  npmLockSha256: sha256(join(consumer, "package-lock.json")),
  rootManifestSha256: sha256(join(root, "package.json")),
  upstreamAudit,
  resolvedGraph,
  negativeDiagnostics: diagnostics.map((match) => ({
    line: Number(match[1]),
    code: match[2]
  })),
  declarationSetting:
    "skipLibCheck:true; upstream full declaration check separately recorded",
  publicExportCount: Object.keys(manifest.exports).length,
  receipts
}
writeFileSync(join(consumer, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
console.log(`Packed native A+B/runtime PASS; artifact sha256=${receipt.archiveSha256}`)
console.log(`Current foreign declarations: ${upstreamAudit.status}; consumer=${consumer}`)
if (upstreamAudit.blocking) {
  process.exitCode = 1
}
