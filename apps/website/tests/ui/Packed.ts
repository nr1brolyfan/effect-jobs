// Finite installed-consumer qualification; filesystem/subprocess FFI only.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const root = resolve(import.meta.dirname, "../../../..")
const evidenceRoot = join(root, ".multica/ui-packed")
mkdirSync(evidenceRoot, { recursive: true })
const evidence = mkdtempSync(join(evidenceRoot, "run-"))
const commandResults: Array<{ readonly name: string; readonly exitCode: number }> = []
const run = (
  name: string,
  command: string,
  args: string[],
  cwd = root,
  env: NodeJS.ProcessEnv = process.env
): string => {
  try {
    const output = execFileSync(command, args, {
      cwd,
      env,
      timeout: 600_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
    commandResults.push({ name, exitCode: 0 })
    writeFileSync(join(evidence, `${name}.log`), output)
    return output
  } catch (error) {
    const failure = error as Error & {
      readonly stdout?: string
      readonly stderr?: string
      readonly status?: number
    }
    commandResults.push({ name, exitCode: failure.status ?? 1 })
    writeFileSync(
      join(evidence, `${name}.log`),
      `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`
    )
    throw error
  }
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const website = JSON.parse(
  readFileSync(join(root, "apps/playground/package.json"), "utf8")
)
const dependencies = { ...website.dependencies, ...website.devDependencies }
delete dependencies["@effect-jobs/playground-contracts"]
delete dependencies["effect-jobs"]
run("pack", "node", ["scripts/pack-release.mjs"], root, {
  ...process.env,
  EFFECT_JOBS_ARTIFACT_DIRECTORY: join(evidence, "artifact")
})
const archive = join(evidence, "artifact", `effect-jobs-${manifest.version}.tgz`)
const inventory = run("inventory", "tar", ["-tzf", archive]).trim().split("\n")
assert(!inventory.some((entry) => /(?:apps|packages|node_modules)\//.test(entry)))
for (const entry of inventory.filter(
  (path) => path.startsWith("package/dist/") && !path.endsWith("/")
)) {
  assert.deepEqual(
    execFileSync("tar", ["-xOf", archive, entry], { timeout: 60_000 }),
    readFileSync(join(root, entry.slice(8)))
  )
}
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-ui-consumer-"))
const fixture = join(root, "apps/website/tests/packed")
const consumerManifest = JSON.parse(
  readFileSync(join(fixture, "consumer.json"), "utf8")
) as { dependencies: Record<string, string> }
for (const [name, version] of Object.entries(dependencies)) {
  assert.equal(
    consumerManifest.dependencies[name],
    version,
    `Consumer pin differs from playground: ${name}`
  )
}
cpSync(join(fixture, "consumer.json"), join(consumer, "package.json"))
// Only release bytes from the independently packed archive are installed.
// The file dependency points to a tarball, never the repository.
cpSync(archive, join(consumer, "effect-jobs.tgz"))
const contracts = join(evidence, "contracts-package/package")
mkdirSync(contracts, { recursive: true })
for (const path of ["package.json", "src", "dist"]) {
  cpSync(join(root, "packages/playground-contracts", path), join(contracts, path), {
    recursive: true
  })
}
const contractsManifest = JSON.parse(
  readFileSync(join(contracts, "package.json"), "utf8")
)
contractsManifest.dependencies["effect-jobs"] = manifest.version
writeFileSync(
  join(contracts, "package.json"),
  JSON.stringify(contractsManifest, null, 2) + "\n"
)
run("pack-contracts", "tar", [
  "-czf",
  join(consumer, "contracts.tgz"),
  "-C",
  join(evidence, "contracts-package"),
  "package"
])
const lockTemplatePath = join(fixture, "consumer.lock")
const artifactLock = (template: string) =>
  template
    .split("\n")
    .map((line) => {
      for (const [name, file] of [
        ["effect-jobs", "effect-jobs.tgz"],
        ["@effect-jobs/playground-contracts", "contracts.tgz"]
      ] as const) {
        if (line.trimStart().startsWith(`"${name}": ["${name}@./${file}",`)) {
          assert.match(line, /"sha512-[^"]+"\],?$/)
          const integrity =
            "sha512-" +
            createHash("sha512")
              .update(readFileSync(join(consumer, file)))
              .digest("base64")
          return line.replace(/"sha512-[^"]+"(?=\],?$)/, JSON.stringify(integrity))
        }
      }
      return line
    })
    .join("\n")
if (process.argv.includes("--write-consumer-lock")) {
  run("lock-authoring", "bun", ["install", "--ignore-scripts"], consumer)
  cpSync(join(consumer, "bun.lock"), join(fixture, "consumer.lock"))
  console.log(
    "Authored the isolated consumer lock; run again without --write-consumer-lock to qualify fresh installation"
  )
  process.exitCode = 0
} else {
  writeFileSync(
    join(consumer, "bun.lock"),
    artifactLock(readFileSync(lockTemplatePath, "utf8"))
  )
  run("install", "bun", ["install", "--frozen-lockfile", "--ignore-scripts"], consumer)
  assert.equal(
    readFileSync(join(consumer, "bun.lock"), "utf8"),
    artifactLock(readFileSync(lockTemplatePath, "utf8"))
  )
}
const reduxDeclaration = readFileSync(
  join(consumer, "node_modules/@reduxjs/toolkit/dist/index.d.ts")
)
assert.equal(
  createHash("sha256").update(reduxDeclaration).digest("hex"),
  "4ebd4061b84c620b21e519842bab9f1a42b3c48e17ba7742ee172492e81a518d"
)
const reduxManifest = JSON.parse(
  readFileSync(join(consumer, "node_modules/@reduxjs/toolkit/package.json"), "utf8")
)
assert.equal(reduxManifest.version, "2.13.0")
for (const entry of inventory.filter(
  (path) => path.startsWith("package/dist/") && !path.endsWith("/")
)) {
  assert.deepEqual(
    readFileSync(join(consumer, "node_modules/effect-jobs", entry.slice(8))),
    readFileSync(join(root, entry.slice(8)))
  )
}
// Preserve relative imports, including browser-consumed scenario Schemas.
// Copy source inputs only; dependencies are independently installed above.
for (const path of [
  "apps/playground/src",
  "apps/playground/build.ts",
  "apps/playground/vite.config.ts",
  "apps/playground/tests/fixtures"
]) {
  cpSync(join(root, path), join(consumer, path), { recursive: true })
}
for (const file of ["Definitions.ts", "PrivateDocument.ts"]) {
  const directory = join(consumer, "apps/playground-worker/src/scenarios")
  mkdirSync(directory, { recursive: true })
  cpSync(join(root, "apps/playground-worker/src/scenarios", file), join(directory, file))
}
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "ESNext.Disposable"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: false,
        noEmit: true,
        jsx: "react-jsx",
        types: ["node"]
      },
      include: [
        "apps/playground/src/features/**/*.ts",
        "apps/playground/src/features/**/*.tsx",
        "apps/playground/src/ui/**/*.ts",
        "apps/playground/src/ui/**/*.tsx",
        "apps/playground/src/live/**/*.ts"
      ]
    },
    null,
    2
  )
)
let typeFailure: unknown
try {
  run(
    "types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer
  )
} catch (error) {
  typeFailure = error
}
const strictOutput = readFileSync(join(evidence, "types.log"), "utf8")
const diagnostics = Array.from(
  strictOutput.matchAll(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm),
  (match) => ({
    path: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
    code: match[4],
    message: match[5]
  })
)
assert(typeFailure, "Full foreign strict must retain the accepted six diagnostics")
assert.deepEqual(
  diagnostics.map((diagnostic) => ({
    path: diagnostic.path,
    line: diagnostic.line,
    column: diagnostic.column,
    code: diagnostic.code
  })),
  [
    [994, 146, "TS2344"],
    [994, 249, "TS2344"],
    [994, 346, "TS2344"],
    [997, 74, "TS2344"],
    [1690, 99, "TS2344"],
    [2064, 15, "TS2420"]
  ].map(([line, column, code]) => ({
    path: "node_modules/@reduxjs/toolkit/dist/index.d.ts",
    line,
    column,
    code
  }))
)
// A supplemental own-code check does not relabel the strict declaration gate.
run(
  "own-types",
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--skipLibCheck"],
  consumer
)
run("browser", "node", ["apps/playground/build.ts"], consumer)
writeFileSync(
  join(consumer, "Smoke.ts"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Layer, Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Atoms from "./apps/playground/src/features/jobs/Atoms.js"
import * as FixtureClient from "./apps/playground/tests/fixtures/FixtureClient.js"
import { JobsClient, type Client } from "./apps/playground/src/features/jobs/Adapter.js"
const require = createRequire(import.meta.url)
assert.throws(() => require.resolve("drizzle-orm"))
assert.throws(() => require.resolve("pg"))
const controller = Atoms.make(Fixtures.sandbox)
const items = Array.from({ length: 43 }, (_, index) => ({ ...FixtureClient.page.items[index % 13]!, jobId: Schema.decodeUnknownSync(JobId)("installed-job-" + String(index + 1).padStart(2, "0")) }))
const stats = { ...FixtureClient.page.stats, total: items.length }
for (const state of ["Pending", "RetryScheduled", "Active", "Completed", "Dead", "Isolated", "Cancelled"] as const) {
  stats[state] = items.filter((job) => job.state === state).length
}
const client: Client = { ...FixtureClient.client, list: (request) => {
  const start = request.cursor === undefined ? 0 : items.findIndex((job) => job.jobId === request.cursor) + 1
  const visible = items.slice(start, start + request.limit)
  return Effect.succeed({ ...FixtureClient.page, sandbox: request.sandbox, items: visible, filteredTotal: items.length,
    stats, nextCursor: start + request.limit < items.length ? visible.at(-1)!.jobId : null })
} }
const layer = Layer.succeed(JobsClient, client)
await Effect.runPromise(controller.refresh.pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().page!.items.length, 20)
await Effect.runPromise(controller.next.pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().pageNumber, 2)
assert.equal(controller.snapshot().page!.items[0]!.jobId, "installed-job-21")
await Effect.runPromise(controller.command("scenario", "disabled", "success", 1).pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().pending, undefined)
controller.dispose()
console.log("installed UI state and disabled mock command PASS; no backend peers")
`
)
// Type-check the generated caller too, keeping strict/exact-optional own-code checks.
const configPath = join(consumer, "tsconfig.json")
const config = JSON.parse(readFileSync(configPath, "utf8"))
config.include.push("Smoke.ts")
writeFileSync(configPath, JSON.stringify(config, null, 2))
run(
  "smoke-types",
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--skipLibCheck"],
  consumer
)
writeFileSync(
  join(consumer, "Negative.ts"),
  `import type { Client } from "./apps/playground/src/features/jobs/Adapter.js"
const invalid: Client = { list: () => 1 }
void invalid
`
)
config.include.push("Negative.ts")
writeFileSync(configPath, JSON.stringify(config, null, 2))
let negativeFailed = false
try {
  run(
    "negative-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--skipLibCheck"],
    consumer
  )
} catch {
  negativeFailed = true
}
assert(
  negativeFailed,
  "Broken own caller must fail independently of foreign declarations"
)
assert.match(
  readFileSync(join(evidence, "negative-types.log"), "utf8"),
  /Negative\.ts.*error TS/
)
config.include.pop()
writeFileSync(configPath, JSON.stringify(config, null, 2))
run(
  "smoke-build",
  "bun",
  ["build", "Smoke.ts", "--target=node", "--packages=external", "--outfile=Smoke.mjs"],
  consumer
)
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-smoke`, runtime, ["Smoke.mjs"], consumer)
}
const hashes: Record<string, string> = {}
const record = (directory: string, prefix: string) => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) {
      record(join(directory, item.name), `${prefix}/${item.name}`)
    } else {
      hashes[`${prefix}/${item.name}`] = createHash("sha256")
        .update(readFileSync(join(directory, item.name)))
        .digest("hex")
    }
  }
}
record(join(root, "apps/playground/src"), "apps/playground/src")
for (const file of ["Definitions.ts", "PrivateDocument.ts"]) {
  const path = `apps/playground-worker/src/scenarios/${file}`
  hashes[path] = createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex")
}
const receipt = {
  result: "FAIL",
  acceptedForeignDiagnosticContract: "exact-six FAIL",
  reduxVersion: reduxManifest.version,
  reduxDeclarationSha256: createHash("sha256").update(reduxDeclaration).digest("hex"),
  strictDeclarationGate: typeFailure ? "FAIL (see types.log)" : "PASS",
  evidence,
  baseHead: run("head", "git", ["rev-parse", "HEAD"]).trim(),
  baseTree: run("tree", "git", ["rev-parse", "HEAD^{tree}"]).trim(),
  provenance:
    "sourceHashes, runner, consumer lock and archive hashes identify tested bytes; baseHead/baseTree identify the composed baseline.",
  qualificationRunnerSha256: createHash("sha256")
    .update(readFileSync(import.meta.filename))
    .digest("hex"),
  consumerTemplateLockSha256: createHash("sha256")
    .update(readFileSync(lockTemplatePath))
    .digest("hex"),
  contractsArchiveSha256: createHash("sha256")
    .update(readFileSync(join(consumer, "contracts.tgz")))
    .digest("hex"),
  consumerLockSha256: createHash("sha256")
    .update(readFileSync(join(consumer, "bun.lock")))
    .digest("hex"),
  sourceHashes: hashes,
  archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  consumer,
  tools: {
    node: process.version,
    bun: run("bun-version", "bun", ["--version"]).trim(),
    effect: "4.0.5",
    typescript: "7.0.2"
  },
  commandResults,
  checks: [
    "packed dist byte equality",
    "no apps/private packages in library archive",
    "independent strict own-code UI types without aliases; full declaration gate separately reported",
    "actual UI browser bundle",
    "Node/Bun UI-state smoke without PG/Drizzle peers"
  ],
  notTested: [
    "PostgreSQL",
    "workerd",
    "hosted",
    "durable commands",
    "production route integration"
  ]
}
writeFileSync(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
if (process.env.UI_PACKED_RECEIPT !== undefined) {
  writeFileSync(process.env.UI_PACKED_RECEIPT, JSON.stringify(receipt, null, 2) + "\n")
}
console.log(JSON.stringify(receipt, null, 2))

if (typeFailure) {
  throw new Error(
    "Installed UI strict declaration gate failed; later independent gates completed"
  )
}
