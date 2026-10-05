// Finite packed-consumer gate. Owns only ignored scratch files, never root pins.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
assert.equal(process.version, "v24.15.0")
assert(process.env.D6_RESOURCE_DIRECTORY, "private PG resources required")
mkdirSync(join(root, ".toolchain"), { recursive: true })
const consumer = mkdtempSync(join(root, ".toolchain/drizzle-native-consumer-"))
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
run("build", "bun", ["run", "build"], root)
const archive = join(consumer, "effect-jobs.tgz")
run("pack", "bun", ["pm", "pack", "--ignore-scripts", "--filename", archive], root)
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
assert.equal(manifest.peerDependencies["drizzle-orm"], "1.0.0-rc.5-169397b")
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.0.0",
        "drizzle-orm": "1.0.0-rc.5-169397b",
        "@effect/sql-pg": "4.0.0",
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
// Resolve optional native fixture types for repository lint after a fresh
// checkout, without installing into or editing the root package.
const fixtureModules = fileURLToPath(new URL("node_modules", import.meta.url))
if (!existsSync(fixtureModules)) {
  mkdirSync(fixtureModules)
  for (const entry of readdirSync(join(consumer, "node_modules"))) {
    symlinkSync(join(consumer, "node_modules", entry), join(fixtureModules, entry))
  }
}
for (const file of ["NativeApplication.mts", "NativeQualification.mts"]) {
  copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(consumer, file))
}
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
const upstreamDeclarationStatus = run(
  "upstream-declarations",
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
const receipts = []
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-exports`, runtime, ["compiled/PublicExports.mjs"])
  const evidence = join(consumer, `${runtime}-evidence.json`)
  run(`${runtime}-native`, runtime, ["compiled/NativeQualification.mjs"], consumer, {
    NATIVE_EVIDENCE_FILE: evidence
  })
  const receipt = JSON.parse(readFileSync(evidence, "utf8"))
  assert.equal(receipt.runtime, runtime)
  assert.equal(receipt.runtimeVersion, runtime === "node" ? "v24.15.0" : "1.4.2")
  assert.equal(receipt.success, true)
  assert.deepEqual(receipt.cleanup, { schemas: 0, roles: 0 })
  receipts.push(receipt)
}
const receipt = {
  archiveSha256: sha256(archive),
  npmLockSha256: sha256(join(consumer, "package-lock.json")),
  rootManifestSha256: sha256(join(root, "package.json")),
  upstreamDeclarationStatus,
  declarationSetting:
    "skipLibCheck:true; upstream full declaration check separately recorded",
  publicExportCount: Object.keys(manifest.exports).length,
  receipts
}
writeFileSync(join(consumer, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
console.log(`Packed native qualification PASS; artifact sha256=${receipt.archiveSha256}`)
console.log(
  `Upstream full declaration exit=${upstreamDeclarationStatus}; consumer=${consumer}`
)
