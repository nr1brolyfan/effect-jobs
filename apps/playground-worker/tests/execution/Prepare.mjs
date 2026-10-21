// Independent consumer FFI. All processes have finite deadlines; no app manifest changes.
import assert from "node:assert/strict"
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
import {
  freezeInputs,
  assertFrozen,
  mutationControls
} from "../qualification/FrozenInputs.mjs"
const root = resolve(import.meta.dirname, "../../../..")
const evidence = process.env.EXECUTOR_EVIDENCE ?? join(root, ".multica/executor-evidence")
mkdirSync(evidence, { recursive: true })
const inputPaths = [
  "apps/playground-worker/src",
  "apps/website/src/server",
  "apps/website/src/OriginPolicy.ts",
  "apps/website/src/live/Protocol.ts",
  "apps/playground-worker/tests/execution",
  "apps/playground-worker/tests/cloudflare",
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
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-executor-"))
try {
  writeFileSync(join(evidence, "consumer-location.json"), JSON.stringify({ consumer }))
  const run = (label, cmd, args, cwd = root) => {
    try {
      const output = execFileSync(cmd, args, {
        cwd,
        timeout: 600000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
      writeFileSync(join(evidence, `${label}.log`), output)
      return output
    } catch (error) {
      writeFileSync(
        join(evidence, `${label}.log`),
        String(error.stdout ?? "") + String(error.stderr ?? "")
      )
      throw new Error(label + " failed; see sanitized build log")
    }
  }
  process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = mkdtempSync(join(evidence, "artifact-"))
  const archive = run("pack", "node", ["scripts/pack-release.mjs"]).trim()
  delete process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
  const inventory = run("inventory", "tar", ["-tzf", archive]).trim().split("\n")
  assert(
    !inventory.some(
      (path) =>
        path.includes("/apps/") ||
        path.includes("/packages/") ||
        path.includes("/node_modules/")
    )
  )
  for (const path of inventory.filter(
    (path) => path.startsWith("package/dist/") && !path.endsWith("/")
  )) {
    assert.deepEqual(
      execFileSync("tar", ["-xOf", archive, path], { timeout: 60000 }),
      readFileSync(join(root, path.slice(8)))
    )
  }

  cpSync(join(root, "packages/playground-contracts"), join(consumer, "contracts"), {
    recursive: true,
    filter: (path) => !path.includes("node_modules") && !path.includes("qualification")
  })
  const contract = JSON.parse(
    readFileSync(join(consumer, "contracts/package.json"), "utf8")
  )
  contract.dependencies["effect-jobs"] = `file:${archive}`
  writeFileSync(join(consumer, "contracts/package.json"), JSON.stringify(contract))
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.0.5",
        "@effect/sql-pg": "4.0.5",
        "@effect-jobs/playground-contracts": "file:./contracts",
        "@types/node": "26.4.1",
        typescript: "7.0.2",
        esbuild: "0.25.12",
        pg: "8.23.0",
        miniflare: "5.20261006.1-alpha"
      }
    })
  )
  run(
    "consumer-install",
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer
  )
  // Copy actual transitive application modules with their original relative topology.
  for (const path of [
    "apps/playground-worker/src",
    "apps/website/src/server",
    "apps/website/src/OriginPolicy.ts",
    "apps/website/src/live/Protocol.ts"
  ]) {
    cpSync(join(root, path), join(consumer, path), { recursive: true })
  }
  for (const name of ["Probe.mjs", "Worker.mjs", "Harness.mjs"]) {
    cpSync(
      join(
        root,
        "apps/playground-worker/tests/execution",
        name === "Probe.mjs" && process.env.EXECUTOR_FOCUSED === "1"
          ? "AffectedProbe.mjs"
          : name
      ),
      join(consumer, name)
    )
    const target = join(consumer, name)
    writeFileSync(
      target,
      readFileSync(target, "utf8").replaceAll(
        "../../src/",
        "./dist/playground-worker/src/"
      )
    )
  }
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
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
        types: ["node"],
        rootDir: "apps",
        outDir: "dist",
        declaration: true
      },
      include: [
        "apps/playground-worker/src/persistence/MigrationRegistry.ts",
        ...[
          "execution",
          "scenarios",
          "providers",
          "persistence/authority",
          "persistence/commands",
          "cloudflare"
        ].map((directory) => `apps/playground-worker/src/${directory}/**/*.ts`)
      ]
    })
  )
  run(
    "strict-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer
  )
  run(
    "worker-bundle",
    "node_modules/.bin/esbuild",
    [
      "Worker.mjs",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--external:cloudflare:*",
      "--external:node:*",
      "--outfile=Worker.js"
    ],
    consumer
  )
  for (const name of ["RealPgProbe.mjs", "RealPgWorker.mjs", "RealPgHarness.mjs"]) {
    writeFileSync(
      join(consumer, name),
      readFileSync(
        join(root, "apps/playground-worker/tests/cloudflare", name),
        "utf8"
      ).replaceAll("../../src/", "./dist/playground-worker/src/")
    )
  }
  run(
    "real-pg-worker-bundle",
    "node_modules/.bin/esbuild",
    [
      "RealPgWorker.mjs",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--external:cloudflare:*",
      "--external:node:*",
      "--outfile=RealPgWorker.js"
    ],
    consumer
  )
  assertFrozen(frozen, freezeInputs(root, inputPaths))
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
  writeFileSync(
    join(evidence, "prepared.json"),
    JSON.stringify(
      {
        consumer,
        archiveSha256: hash(archive),
        startHead: run("head", "git", ["rev-parse", "HEAD"]).trim(),
        provenance: frozen,
        negativeControls,
        consumerLockSha256: hash(join(consumer, "package-lock.json")),
        workerSha256: hash(join(consumer, "Worker.js")),
        realPgWorkerSha256: hash(join(consumer, "RealPgWorker.js")),
        node: process.version,
        bun: run("bun-version", "bun", ["--version"]).trim(),
        workerd: run(
          "workerd-version",
          "node_modules/.bin/workerd",
          ["--version"],
          consumer
        ).trim()
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify({ consumer, prepared: true }))
} catch (error) {
  rmSync(consumer, { recursive: true, force: true })
  writeFileSync(
    join(evidence, "prepare-cleanup.json"),
    JSON.stringify({ consumer, removed: true })
  )
  throw error
}
