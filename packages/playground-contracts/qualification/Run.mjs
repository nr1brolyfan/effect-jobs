// Node subprocess/filesystem FFI is confined to this finite qualification runner.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const root = resolve(import.meta.dirname, "../../..")
const evidence = join(root, ".toolchain/playground")
mkdirSync(evidence, { recursive: true })
const work = mkdtempSync(join(evidence, "packed-"))
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
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
assert.equal(manifest.name, "effect-jobs")
assert.equal(manifest.private, false)
assert.equal(manifest.dependencies, undefined)
for (const subpath of Object.keys(manifest.exports)) {
  const file = subpath === "." ? "index" : subpath.slice(2)
  const installed = join(
    root,
    "packages/playground-contracts/node_modules/effect-jobs/dist",
    `${file}.js`
  )
  assert.equal(
    readFileSync(installed, "utf8"),
    readFileSync(join(root, "dist", `${file}.js`), "utf8"),
    "Refresh the root file dependency after build"
  )
}
assert.equal(
  realpathSync(join(root, "apps/website/node_modules/@effect-jobs/playground-contracts")),
  join(root, "packages/playground-contracts")
)
const previousDirectory = process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = join(work, "artifact")
try {
  run("pack", "node", ["scripts/pack-release.mjs"])
} finally {
  if (previousDirectory === undefined) {
    delete process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
  } else {
    process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = previousDirectory
  }
}
const archive = join(work, "artifact", `effect-jobs-${manifest.version}.tgz`)
const entries = run("inventory", "tar", ["-tzf", archive]).trim().split("\n")
assert(
  entries.every((entry) =>
    /^package\/(dist\/|specs\/|package.json$|README.md$|CHANGELOG.md$|LICENSE$)/.test(
      entry
    )
  )
)
assert(!entries.some((entry) => /(?:apps|packages|node_modules)\//.test(entry)))
const packedManifest = JSON.parse(
  run("manifest", "tar", ["-xOf", archive, "package/package.json"])
)
assert.deepEqual(packedManifest, manifest)
for (const entry of entries.filter(
  (entry) => entry.startsWith("package/dist/") && !entry.endsWith("/")
)) {
  assert.deepEqual(
    execFileSync("tar", ["-xOf", archive, entry], { timeout: 60_000 }),
    readFileSync(join(root, entry.slice(8)))
  )
}
const consumer = mkdtempSync(join(tmpdir(), "effect-jobs-playground-"))
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
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
cpSync(join(root, "packages/playground-contracts/src"), join(consumer, "src"), {
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
        skipLibCheck: false,
        declaration: true,
        rootDir: "src",
        outDir: "dist"
      },
      include: ["src/**/*.ts"]
    },
    null,
    2
  )
)
run("types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], consumer)
writeFileSync(
  join(consumer, "Smoke.mjs"),
  `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { encodeJobPayload, decodeJobPayload } from "effect-jobs/JobPayloadCodec"
import { JobDetail, JobPage } from "./dist/Jobs.js"
import { ScenarioJob } from "./dist/Definitions.js"
import { JobsRead, Changes } from "./dist/Services.js"
import * as Fixtures from "./dist/Fixtures.js"
import * as MockLayer from "./dist/MockLayer.js"
const require = createRequire(import.meta.url)
assert.throws(() => require.resolve("drizzle-orm"))
assert.throws(() => require.resolve("pg"))
assert(Schema.is(JobDetail)(Fixtures.detail))
assert(Schema.is(JobPage)(Fixtures.page))
const payload = Schema.decodeUnknownSync(ScenarioJob.payload)({ sandbox: Fixtures.sandbox.ref, scenario: "success", sequence: 1 })
const encoded = await Effect.runPromise(encodeJobPayload(ScenarioJob.payload, payload))
assert.deepEqual(await Effect.runPromise(decodeJobPayload(ScenarioJob.payload, encoded)), payload)
// Fixture time is explicit; expiration behavior is qualified separately with TestClock.
const access = { sandbox: Fixtures.sandbox }
const page = await Effect.runPromise(Effect.flatMap(JobsRead, (service) => service.list(access, { sandbox: access.sandbox.ref, filters: {}, limit: 50 })).pipe(Effect.provide(MockLayer.layer), Effect.provide(TestClock.layer())))
assert.deepEqual(page, Fixtures.page)
const changes = await Effect.runPromise(Effect.flatMap(Changes, (service) => service.read(access, { sandbox: access.sandbox.ref })).pipe(Effect.provide(MockLayer.layer), Effect.provide(TestClock.layer())))
assert.equal(changes.mode, "poll-only")
console.log("packed contracts: strict types, real library codec, absent backend peers, mock reads PASS")
`
)
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-smoke`, runtime, ["Smoke.mjs"], consumer)
}
run(
  "browser",
  "bun",
  ["build", "src/Jobs.ts", "src/Definitions.ts", "--target=browser", "--outdir=browser"],
  consumer
)
const inputPaths = run("input-paths", "git", [
  "ls-files",
  "-z",
  "src",
  "apps",
  "packages/playground-contracts",
  "package.json",
  "bun.lock",
  "tsconfig.playground.json",
  "docs/playground-foundation.md"
])
  .split("\0")
  .filter(Boolean)
const receipt = {
  head: run("head", "git", ["rev-parse", "HEAD"]).trim(),
  indexTree: run("tree", "git", ["write-tree"]).trim(),
  inputsSha256: Object.fromEntries(
    inputPaths.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex")
    ])
  ),
  archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  libraryVersion: manifest.version,
  tools: {
    node: process.version,
    bun: run("bun-version", "bun", ["--version"]).trim(),
    npm: run("npm-version", "npm", ["--version"]).trim()
  },
  checks: [
    "root file dependency matches dist",
    "contracts workspace link",
    "pack inventory and byte equality",
    "independent strict packed contracts compile",
    "Node and Bun codec/mock smoke",
    "browser bundle without backend peers"
  ],
  notTested: [
    "PostgreSQL",
    "workerd",
    "Cloudflare hosting",
    "durable authority/reset/receipts",
    "downstream UI/live/executor"
  ],
  consumer
}
writeFileSync(join(work, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
console.log(JSON.stringify(receipt, null, 2))
