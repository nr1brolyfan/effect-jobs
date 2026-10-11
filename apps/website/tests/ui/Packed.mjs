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
        "effect-jobs": `file:${archive}`,
        effect: "4.0.0",
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
cpSync(join(root, "apps/website/src/features/jobs"), join(consumer, "src"), {
  recursive: true
})
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
        noEmit: true
      },
      include: ["src/**/*.ts"]
    },
    null,
    2
  )
)
run("types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], consumer)
run(
  "browser",
  "bun",
  ["build", "src/View.ts", "src/FixtureEntry.ts", "--target=browser", "--outdir=browser"],
  consumer
)
writeFileSync(
  join(consumer, "Smoke.ts"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Layer } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Controller from "./src/Controller.js"
import * as FixtureClient from "./src/FixtureClient.js"
import { JobsClient } from "./src/Adapter.js"
const require = createRequire(import.meta.url)
assert.throws(() => require.resolve("drizzle-orm"))
assert.throws(() => require.resolve("pg"))
const controller = Controller.make(Fixtures.sandbox, () => {})
const layer = Layer.succeed(JobsClient, FixtureClient.client)
await Effect.runPromise(controller.refresh.pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().page.items.length, 5)
await Effect.runPromise(controller.next.pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().pageNumber, 2)
assert.equal(controller.snapshot().page.items[0].jobId, "demo-job-06")
await Effect.runPromise(controller.command("scenario", "disabled", "success", 1).pipe(Effect.provide(layer)))
assert.equal(controller.snapshot().pending, undefined)
console.log("installed UI state and disabled mock command PASS; no backend peers")
`
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
record(join(root, "apps/website/src/features/jobs"), "apps/website/src/features/jobs")
const receipt = {
  result: "PASS",
  evidence,
  head: run("head", "git", ["rev-parse", "HEAD"]).trim(),
  tree: run("tree", "git", ["write-tree"]).trim(),
  sourceHashes: hashes,
  archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  consumer,
  tools: {
    node: process.version,
    bun: run("bun-version", "bun", ["--version"]).trim(),
    effect: "4.0.0",
    typescript: "7.0.2"
  },
  checks: [
    "packed dist byte equality",
    "no apps/private packages in library archive",
    "independent strict UI types without aliases",
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
