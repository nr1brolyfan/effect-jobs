// Finite installed/source contract + owned real PG qualification of the order example.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../..")
const sources = join(root, "apps/website/examples/docs/orders")
const scratch = join(root, ".toolchain/order-tutorial")
mkdirSync(scratch, { recursive: true })
const work = mkdtempSync(join(scratch, "run-"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
const hashes = () =>
  Object.fromEntries(
    readdirSync(sources, { recursive: true })
      .filter((f) => f.endsWith(".ts") || f.endsWith(".json"))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((f) => [f, hash(readFileSync(join(sources, f)))])
  )
const receipt = {
  sourceHashes: hashes(),
  results: [],
  limitations:
    "Synthetic local mail and PDF stand-in only; post-durable-COMMIT injected acknowledgement loss, not network/server crash. Supported native dependencies use approved skipLibCheck:true; no foreign declaration-C PASS."
}
const run = (name, command, args, cwd = root, env = {}, required = true) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024
  })
  writeFileSync(join(work, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""))
  receipt.results.push({ name, status: result.status, error: result.error?.message })
  if (required) {
    assert.equal(result.status, 0, `${name} failed; see ${join(work, `${name}.log`)}`)
  }
  console.log(
    `${name} ${result.status === 0 ? "PASS" : "FAIL (unwaived; continuing independent gates)"}`
  )
  return result.stdout.trim()
}
let container
try {
  assert.equal(process.version, "v24.15.0")
  assert.equal(run("bun-version", "bun", ["--version"]), "1.4.2")
  run(
    "source-diagnostics",
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "apps/website/examples/docs/orders/tsconfig.json",
      "--noEmit"
    ],
    root,
    {},
    false
  )
  writeFileSync(
    join(work, "tsconfig.source.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        noEmit: true,
        paths: {
          "effect-jobs/*": [join(root, "src/*.ts")],
          "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
          "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*/index.d.ts")]
        }
      },
      include: [join(sources, "**/*.ts")]
    })
  )
  run("source-types", "node", [
    "node_modules/typescript/bin/tsc",
    "-p",
    join(work, "tsconfig.source.json")
  ])
  run("build", "bun", ["run", "build"])
  run("pack", "npm", ["pack", "--ignore-scripts", "--pack-destination", work])
  const archive = join(
    work,
    readdirSync(work).find((f) => f.endsWith(".tgz"))
  )
  receipt.archiveSha256 = hash(readFileSync(archive))
  const consumer = join(work, "consumer")
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
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
    })
  )
  run(
    "install",
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer
  )
  run("peers", "npm", ["ls", "--all"], consumer)
  cpSync(sources, join(consumer, "source"), { recursive: true })
  cpSync(
    join(import.meta.dirname, "Negative.ts.txt"),
    join(consumer, "source/Negative.ts")
  )
  writeFileSync(
    join(consumer, "source/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        rootDir: ".",
        outDir: "dist"
      },
      include: ["**/*.ts"]
    })
  )
  run(
    "installed-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "source/tsconfig.json"],
    consumer
  )
  writeFileSync(
    join(consumer, "PostgreSql.mjs"),
    readFileSync(join(import.meta.dirname, "PostgreSql.mjs"), "utf8").replaceAll(
      '"../../examples/docs/orders/',
      '"./source/dist/'
    )
  )
  writeFileSync(
    join(consumer, "Bindings.mjs"),
    readFileSync(join(import.meta.dirname, "Bindings.mjs"), "utf8").replaceAll(
      '"../../examples/docs/orders/',
      '"./source/dist/'
    )
  )
  // Loader records the actual transitive runtime graph, not just source import names.
  writeFileSync(
    join(consumer, "ImportLoader.mjs"),
    `import { appendFileSync } from 'node:fs'; export async function resolve(specifier, context, next) { const result = await next(specifier, context); appendFileSync(process.env.ORDER_IMPORT_LOG, result.url + '\\n'); return result; }`
  )
  const importLog = join(work, "producer-imports.log")
  run(
    "producer-imports",
    "node",
    [
      "--experimental-loader",
      "./ImportLoader.mjs",
      "--input-type=module",
      "-e",
      "await import('./source/dist/apps/api/src/orders/PlaceOrderWithInvoice.js')"
    ],
    consumer,
    { ORDER_IMPORT_LOG: importLog }
  )
  const graph = readFileSync(importLog, "utf8")
  assert(
    !/\/apps\/worker\/|SyntheticMail|SendConfirmation|NodeRuntime/.test(graph),
    "Producer must not load consumer/mail/runtime composition"
  )
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
      "owner=order-tutorial-qualification",
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
    for (let i = 0; i < 100; i++) {
      if (
        spawnSync(
          "docker",
          ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
          { timeout: 2000, stdio: "ignore" }
        ).status === 0
      ) {
        ready = true
        break
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
    assert(ready)
    return port
  }
  let port = startDatabase()
  for (const runtime of ["node", "bun"]) {
    if (runtime === "bun") {
      run("pg-node-stop", "docker", ["stop", container])
      container = undefined
      port = startDatabase()
    }
    run(`postgresql-${runtime}`, runtime, ["PostgreSql.mjs"], consumer, {
      DOCS_TEST_PG_PORT: port
    })
  }
  receipt.status = receipt.results.every((r) => r.status === 0)
    ? "PASS"
    : "INCOMPLETE: unwaived source diagnostics"
} finally {
  if (container) {
    run("pg-stop", "docker", ["stop", container])
  }
  receipt.sourceUnchanged =
    JSON.stringify(receipt.sourceHashes) === JSON.stringify(hashes())
  receipt.status ??= "INCOMPLETE"
  writeFileSync(join(work, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
  console.log(`Evidence: ${work}`)
  assert(receipt.sourceUnchanged)
  if (receipt.status !== "PASS") {
    process.exitCode = 1
  }
}
