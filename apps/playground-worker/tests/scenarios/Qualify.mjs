// Finite filesystem/process FFI for an independent packed consumer; no PG or secrets.
import assert from "node:assert/strict"
import {
  freezeInputs,
  assertFrozen,
  mutationControls
} from "../qualification/FrozenInputs.mjs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const evidence = join(root, ".toolchain/scenarios")
mkdirSync(evidence, { recursive: true })
const work = mkdtempSync(join(evidence, "packed-"))
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-scenarios-"))
try {
  const run = (name, command, args, cwd = root) => {
    try {
      const output = execFileSync(command, args, {
        cwd,
        timeout: 600_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
      writeFileSync(join(work, `${name}.log`), output)
      return output
    } catch (error) {
      writeFileSync(
        join(work, `${name}.log`),
        `${error.stdout ?? ""}\n${error.stderr ?? ""}`
      )
      throw error
    }
  }
  const inputPaths = [
    "apps/playground-worker/src/scenarios",
    "apps/playground-worker/src/providers",
    "apps/playground-worker/src/persistence/authority/PrivateMode.ts",
    "apps/playground-worker/src/persistence/authority/Schema.ts",
    "apps/playground-worker/tests/scenarios",
    "apps/playground-worker/tests/qualification",
    "packages/playground-contracts",
    "src",
    "scripts",
    "package.json",
    "bun.lock",
    "tsconfig.build.json",
    "tsconfig.playground.json"
  ]
  const frozen = freezeInputs(root, inputPaths)
  const negativeControls = mutationControls(root)
  writeFileSync(join(work, "frozen-inputs.json"), JSON.stringify(frozen, null, 2))
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const previous = process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
  process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = join(work, "artifact")
  try {
    run("pack", "node", ["scripts/pack-release.mjs"])
  } finally {
    if (previous === undefined) {
      delete process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
    } else {
      process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = previous
    }
  }
  const archive = join(work, "artifact", `effect-jobs-${manifest.version}.tgz`)
  const inventory = run("inventory", "tar", ["-tzf", archive]).trim().split("\n")
  assert(!inventory.some((path) => /(?:apps|packages|node_modules)\//.test(path)))
  for (const path of inventory.filter(
    (path) => path.startsWith("package/dist/") && !path.endsWith("/")
  )) {
    assert.deepEqual(
      execFileSync("tar", ["-xOf", archive, path], { timeout: 60_000 }),
      readFileSync(join(root, path.slice(8)))
    )
  }
  cpSync(join(root, "packages/playground-contracts"), join(consumer, "contracts"), {
    recursive: true,
    filter: (path) => !path.includes("node_modules") && !path.includes("qualification")
  })
  // Relocate only this disposable manifest's root dependency to the immutable pack.
  // All contract source/dist bytes remain the frozen foundation's actual bytes.
  const contractsManifestPath = join(consumer, "contracts/package.json")
  const contractsManifest = JSON.parse(readFileSync(contractsManifestPath, "utf8"))
  contractsManifest.dependencies["effect-jobs"] = `file:${archive}`
  writeFileSync(contractsManifestPath, JSON.stringify(contractsManifest, null, 2))
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "effect-jobs": `file:${archive}`,
          effect: "4.1.0",
          typescript: "7.0.2",
          "@types/node": "26.4.1",
          vitest: "4.1.11",
          "@effect-jobs/playground-contracts": "file:./contracts"
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
  for (const directory of [
    "src/scenarios",
    "src/providers",
    "src/persistence/authority/PrivateMode.ts",
    "src/persistence/authority/Schema.ts",
    "tests/scenarios"
  ]) {
    cpSync(
      join(root, "apps/playground-worker", directory),
      join(consumer, "app", directory),
      { recursive: true }
    )
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
          declaration: true,
          rootDir: "app",
          outDir: "dist"
        },
        include: ["app/**/*.ts"]
      },
      null,
      2
    )
  )
  run(
    "strict-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer
  )
  run(
    "tests",
    "node",
    ["node_modules/vitest/vitest.mjs", "run", "app/tests/scenarios"],
    consumer
  )
  writeFileSync(
    join(consumer, "Smoke.mjs"),
    `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Definitions from "./dist/src/scenarios/Definitions.js"
import * as Plan from "./dist/src/scenarios/Plan.js"
import * as PrivateDocument from "./dist/src/scenarios/PrivateDocument.js"
import { FakeProvider } from "./dist/src/providers/FakeProvider.js"
import * as Provider from "./dist/src/providers/FakeProviderLayer.js"
import { sandbox } from "@effect-jobs/playground-contracts/Fixtures"
const require = createRequire(import.meta.url)
assert.throws(() => require.resolve("drizzle-orm"))
assert.throws(() => require.resolve("pg"))
await Effect.runPromise(Effect.gen(function* () {
  const plans = yield* Plan.plan({ sandbox: sandbox.ref, requestId: "packed-smoke", scenario: "unknown-outcome", count: 6 }, sandbox.ref, 0)
  const job = plans[3]
  const payload = Plan.exportPayload(job.payload)
  const one = yield* Codec.encodeJobPayload(Definitions.ExportPayload, payload)
  const two = yield* Codec.encodeJobPayload(Definitions.ExportPayload, payload)
  assert.notDeepEqual(one.payloadBytes, two.payloadBytes)
  assert.deepEqual(one.semanticProjectionBytes, two.semanticProjectionBytes)
  assert.deepEqual(yield* Codec.decodeJobPayload(Definitions.ExportPayload, one), payload)
  const provider = yield* FakeProvider
  const command = { sandbox: payload.sandbox, producer: job.producer, workload: job.workload, behavior: payload.behavior, semanticProjection: one.semanticProjectionBytes }
  assert.equal((yield* Effect.flip(provider.execute(command)))._tag, "ResponseLost")
  assert.equal((yield* provider.inspect(command)).effects, 1)
  yield* provider.execute({ ...command, semanticProjection: two.semanticProjectionBytes })
  assert.equal((yield* provider.inspect(command)).effects, 1)
}).pipe(Effect.provide(PrivateDocument.keysLayer), Effect.provide(Provider.layer)))
console.log("packed scenarios: encrypted typed payload and idempotent response-loss reconciliation PASS")
`
  )
  for (const runtime of ["node", "bun"]) {
    run(`${runtime}-smoke`, runtime, ["Smoke.mjs"], consumer)
  }
  run(
    "browser",
    "bun",
    [
      "build",
      "app/src/scenarios/Handlers.ts",
      "app/src/scenarios/Plan.ts",
      "app/src/providers/FakeProviderLayer.ts",
      "--target=browser",
      "--outdir=browser"
    ],
    consumer
  )
  assertFrozen(frozen, freezeInputs(root, inputPaths))
  const receipt = {
    head: run("head", "git", ["rev-parse", "HEAD"]).trim(),
    provenance: frozen,
    negativeControls,
    archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    tools: {
      node: process.version,
      bun: run("bun-version", "bun", ["--version"]).trim(),
      npm: run("npm-version", "npm", ["--version"]).trim()
    },
    checks: [
      "packed dist byte equality",
      "independent strict declarations",
      "Node focused tests",
      "Node/Bun Web Crypto smoke",
      "browser bundle",
      "absent pg/drizzle peers"
    ],
    notTested: [
      "PostgreSQL",
      "workerd",
      "hosting",
      "durable ledger/key custody",
      "atomic app receipt/authority integration"
    ],
    consumer
  }
  writeFileSync(join(work, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
  console.log(
    JSON.stringify(
      {
        evidence: work,
        head: receipt.head,
        inputsSha256: frozen.inputsSha256,
        checks: receipt.checks,
        notTested: receipt.notTested
      },
      null,
      2
    )
  )
} finally {
  rmSync(consumer, { recursive: true, force: true })
  writeFileSync(join(work, "cleanup.json"), JSON.stringify({ consumer, removed: true }))
}
