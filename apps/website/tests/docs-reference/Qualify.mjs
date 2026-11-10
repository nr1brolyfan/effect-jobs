// Finite source+current-packed qualification. No private env files or provider keys.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const sources = join(root, "apps/website/examples/docs")
const scratch = join(root, ".toolchain/docs-reference")
mkdirSync(scratch, { recursive: true })
const work = mkdtempSync(join(scratch, "run-"))
const results = []
const run = (name, command, args, cwd = root, env = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  })
  writeFileSync(join(work, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""))
  results.push({ name, status: result.status })
  assert.equal(result.status, 0, `${name} failed; see ${join(work, `${name}.log`)}`)
  console.log(`${name} PASS`)
  return result.stdout.trim()
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const sourceHashes = Object.fromEntries(
  readdirSync(sources)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => [file, hash(readFileSync(join(sources, file)))])
)
assert.deepEqual(Object.keys(sourceHashes), [
  "DrizzleReportRequest.ts",
  "Migrations.ts",
  "NodeReportFiles.ts",
  "PostgreSqlReports.ts",
  "ReportWorkflow.ts",
  "RunReports.ts"
])
const receipt = {
  node: process.version,
  sourceHashes,
  qualificationHashes: Object.fromEntries(
    readdirSync(import.meta.dirname)
      .sort()
      .map((file) => [file, hash(readFileSync(join(import.meta.dirname, file)))])
  ),
  results,
  limitations:
    "Local synthetic reports; no provider or cloud delivery. Real-PG tests prove the listed cases, not crash/network-loss durability. Core strict declarations use skipLibCheck:false; native PG uses approved dependency skipLibCheck:true. No Drizzle declaration-C PASS is claimed."
}
let container
try {
  assert.equal(process.version, "v24.15.0")
  assert.equal(run("bun-version", "bun", ["--version"]), "1.4.2")
  run("reference", "node", ["apps/website/tests/docs-reference/Reference.mjs", "--check"])
  run("snippets", "node", ["apps/website/tests/docs-reference/Snippets.mjs"])
  run("build", "bun", ["run", "build"])
  run("pack", "npm", ["pack", "--ignore-scripts", "--pack-destination", work])
  const archive = join(
    work,
    readdirSync(work).find((file) => file.endsWith(".tgz"))
  )
  receipt.archiveSha256 = hash(readFileSync(archive))
  const consumer = join(work, "consumer")
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "effect-jobs": `file:${archive}`,
          effect: "4.0.5",
          "drizzle-orm": "1.0.0-rc.5-ab785fc",
          "@effect/sql-pg": "4.0.5",
          "@effect/platform-node": "4.0.5",
          "@effect/platform-node-shared": "4.0.5",
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
  run("peers", "npm", ["ls", "--all"], consumer)
  for (const name of Object.keys(sourceHashes)) {
    copyFileSync(join(sources, name), join(consumer, name))
  }
  copyFileSync(
    join(import.meta.dirname, "Negative.ts.txt"),
    join(consumer, "Negative.ts")
  )
  const options = {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    outDir: "compiled",
    types: ["node"]
  }
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({ compilerOptions: options, include: ["*.ts"] })
  )
  const sourceOptions = {
    ...options,
    rootDir: root,
    noEmit: true,
    paths: {
      "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
      "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*/index.d.ts")],
      ...Object.fromEntries(
        Object.keys(JSON.parse(readFileSync(join(root, "package.json"))).exports)
          .filter((key) => key !== ".")
          .map((key) => [
            `effect-jobs/${key.slice(2)}`,
            [join(root, `src/${key.slice(2)}.ts`)]
          ])
      )
    }
  }
  writeFileSync(
    join(consumer, "tsconfig.source.json"),
    JSON.stringify({ compilerOptions: sourceOptions, include: ["*.ts"] })
  )
  writeFileSync(
    join(consumer, "tsconfig.core.json"),
    JSON.stringify({
      compilerOptions: { ...options, noEmit: true, skipLibCheck: false },
      include: ["ReportWorkflow.ts", "NodeReportFiles.ts", "Migrations.ts", "Negative.ts"]
    })
  )
  run(
    "source-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.source.json"],
    consumer
  )
  run(
    "packed-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer
  )
  run(
    "core-strict",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.core.json"],
    consumer
  )
  // Fixtures resolve canonical source during repository lint. Relocate only their
  // example imports to the exact JavaScript emitted by the strict packed compile.
  for (const file of [
    "Runtime.mjs",
    "PostgreSqlRuntime.mjs",
    "DrizzlePrototypePostgreSql.mjs",
    "DrizzlePrototypeRuntime.mjs"
  ]) {
    const fixture = readFileSync(join(import.meta.dirname, file), "utf8")
    writeFileSync(
      join(consumer, file),
      fixture.replaceAll('"../../examples/docs/', '"./compiled/')
    )
  }
  for (const runtime of ["node", "bun"]) {
    run(`runtime-${runtime}`, runtime, ["Runtime.mjs"], consumer)
    run(`drizzle-runtime-${runtime}`, runtime, ["DrizzlePrototypeRuntime.mjs"], consumer)
  }
  // This gate owns only this exact container; never touches existing databases.
  const startDatabase = () => {
    container = run("pg-start", "docker", [
      "run",
      "--rm",
      "-d",
      "--label",
      "project=52ccc13e-4995-4a3f-be37-6f4cf6bebe3e",
      "--label",
      "issue=UPVE-2612",
      "--label",
      "owner=docs-reference-qualification",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-p",
      "127.0.0.1::5432",
      "postgres:17"
    ])
    assert.match(container, /^[a-f0-9]{64}$/)
    receipt.postgresImage = run("pg-image", "docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      container
    ])
    const port = run("pg-port", "docker", ["port", container, "5432/tcp"])
      .split(":")
      .at(-1)
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        spawnSync(
          "docker",
          ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
          {
            timeout: 2000,
            stdio: "ignore"
          }
        ).status === 0
      ) {
        ready = true
        break
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
    assert(ready, "Disposable PG must become ready")
    return port
  }
  let port = startDatabase()
  for (const runtime of ["node", "bun"]) {
    if (runtime === "bun") {
      run("pg-node-stop", "docker", ["stop", container])
      container = undefined
      port = startDatabase()
    }
    run(`postgresql-${runtime}`, runtime, ["PostgreSqlRuntime.mjs"], consumer, {
      DOCS_TEST_PG_PORT: port
    })
    run(`pg-report-stop-${runtime}`, "docker", ["stop", container])
    container = undefined
    port = startDatabase()
    run(
      `prototype-postgresql-${runtime}`,
      runtime,
      ["DrizzlePrototypePostgreSql.mjs"],
      consumer,
      {
        DOCS_TEST_PG_PORT: port
      }
    )
  }
  receipt.status = "PASS"
} finally {
  if (container) {
    run("pg-stop", "docker", ["stop", container])
  }
  receipt.sourceUnchanged = Object.entries(sourceHashes).every(
    ([file, sha]) => hash(readFileSync(join(sources, file))) === sha
  )
  if (!receipt.sourceUnchanged) {
    receipt.status = "STALE"
  }
  writeFileSync(join(work, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
  assert(receipt.sourceUnchanged, "Canonical examples changed during qualification")
  console.log(`Evidence: ${work}`)
}
