// Independent consumer FFI. All processes have finite deadlines; no app manifest changes.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../..")
const evidence = process.env.EXECUTOR_EVIDENCE ?? join(root, ".multica/executor-evidence")
mkdirSync(evidence, { recursive: true })
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-executor-"))
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
      effect: "4.0.0",
      "@effect/sql-pg": "4.0.0",
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
for (const directory of [
  "execution",
  "scenarios",
  "providers",
  "persistence/authority",
  "persistence/commands",
  "cloudflare"
]) {
  cpSync(
    join(root, "apps/playground-worker/src", directory),
    join(consumer, "app/src", directory),
    { recursive: true }
  )
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
      rootDir: "app",
      outDir: "dist",
      declaration: true
    },
    include: ["app/**/*.ts"]
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
const files = run("input-paths", "git", [
  "ls-files",
  "-co",
  "--exclude-standard",
  "apps/playground-worker/src",
  "apps/playground-worker/tests/execution",
  "packages/playground-contracts",
  "src",
  "package.json",
  "bun.lock",
  "tsconfig.playground.json"
])
  .trim()
  .split("\n")
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
writeFileSync(
  join(evidence, "prepared.json"),
  JSON.stringify(
    {
      consumer,
      archiveSha256: hash(archive),
      startHead: run("head", "git", ["rev-parse", "HEAD"]).trim(),
      startTree: run("tree", "git", ["write-tree"]).trim(),
      inputs: Object.fromEntries(
        [...new Set(files)].map((path) => [path, hash(join(root, path))])
      ),
      consumerLockSha256: hash(join(consumer, "package-lock.json")),
      workerSha256: hash(join(consumer, "Worker.js")),
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
