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
const run = (name, command, args, cwd = root, env = process.env) => {
  try {
    const output = execFileSync(command, args, {
      cwd,
      env,
      timeout: 600_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
    writeFileSync(join(evidence, `${name}.log`), output)
    return output
  } catch (error) {
    writeFileSync(
      join(evidence, `${name}.log`),
      `${error.stdout ?? ""}\n${error.stderr ?? ""}`
    )
    throw error
  }
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const website = JSON.parse(readFileSync(join(root, "apps/website/package.json"), "utf8"))
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
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        ...dependencies,
        "effect-jobs": `file:${archive}`,
        effect: "4.0.5",
        typescript: "7.0.2",
        "@types/node": "26.4.1"
      }
    },
    null,
    2
  )
)
run(
  "install",
  "npm",
  ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  consumer
)
// Copy only the frozen private contracts. The library itself exists solely as
// an installed immutable tarball, with no source tree or workspace aliases.
const contracts = join(consumer, "node_modules/@effect-jobs/playground-contracts")
mkdirSync(contracts, { recursive: true })
for (const path of ["package.json", "src", "dist"]) {
  cpSync(join(root, "packages/playground-contracts", path), join(contracts, path), {
    recursive: true
  })
}
// Preserve relative imports, including browser-consumed scenario Schemas.
// Copy source inputs only; dependencies are independently installed above.
for (const path of ["apps/website/src", "apps/website/build.mjs"]) {
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
        "apps/website/src/features/**/*.ts",
        "apps/website/src/features/**/*.tsx",
        "apps/website/src/ui/**/*.ts",
        "apps/website/src/ui/**/*.tsx",
        "apps/website/src/live/**/*.ts"
      ]
    },
    null,
    2
  )
)
let typeFailure
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
// A supplemental own-code check does not relabel the strict declaration gate.
run(
  "own-types",
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--skipLibCheck"],
  consumer
)
run("browser", "bun", ["apps/website/build.mjs"], consumer)
writeFileSync(
  join(consumer, "Smoke.ts"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Layer, Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Atoms from "./apps/website/src/features/jobs/Atoms.js"
import * as FixtureClient from "./apps/website/src/features/jobs/FixtureClient.js"
import { JobsClient, type Client } from "./apps/website/src/features/jobs/Adapter.js"
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
run(
  "smoke-build",
  "bun",
  ["build", "Smoke.ts", "--target=node", "--packages=external", "--outfile=Smoke.mjs"],
  consumer
)
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-smoke`, runtime, ["Smoke.mjs"], consumer)
}
const hashes = {}
const record = (directory, prefix) => {
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
record(join(root, "apps/website/src"), "apps/website/src")
for (const file of ["Definitions.ts", "PrivateDocument.ts"]) {
  const path = `apps/playground-worker/src/scenarios/${file}`
  hashes[path] = createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex")
}
const receipt = {
  result: typeFailure ? "FAIL" : "PASS",
  strictDeclarationGate: typeFailure ? "FAIL (see types.log)" : "PASS",
  evidence,
  baseHead: run("head", "git", ["rev-parse", "HEAD"]).trim(),
  baseTree: run("tree", "git", ["rev-parse", "HEAD^{tree}"]).trim(),
  provenance:
    "Uncommitted candidate: sourceHashes and archive hash identify tested inputs; baseHead/baseTree are historical metadata only.",
  qualificationRunnerSha256: createHash("sha256")
    .update(readFileSync(import.meta.filename))
    .digest("hex"),
  consumerLockSha256: createHash("sha256")
    .update(readFileSync(join(consumer, "package-lock.json")))
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
console.log(JSON.stringify(receipt, null, 2))

if (typeFailure) {
  throw new Error(
    "Installed UI strict declaration gate failed; later independent gates completed"
  )
}
