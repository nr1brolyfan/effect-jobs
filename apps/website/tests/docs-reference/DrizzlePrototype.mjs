// Isolated installed-artifact compile + synthetic canonical example execution.
// Does not start Docker or reinterpret this as a real-PG qualification.
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
const scratch = join(root, ".toolchain/drizzle-prototype")
mkdirSync(scratch, { recursive: true })
const work = mkdtempSync(join(scratch, "run-"))
const results = []
const run = (name, command, args, cwd = root) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  })
  writeFileSync(join(work, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""))
  results.push({ name, status: result.status })
  assert.equal(result.status, 0, `${name} failed; see ${work}`)
  console.log(`${name} PASS`)
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const sources = join(root, "apps/website/examples/docs")
const sourceHashes = Object.fromEntries(
  readdirSync(sources)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => [file, hash(readFileSync(join(sources, file)))])
)
try {
  assert.equal(process.version, "v24.15.0")
  run("build", "bun", ["run", "build"])
  run("pack", "npm", ["pack", "--ignore-scripts", "--pack-destination", work])
  const archive = join(
    work,
    readdirSync(work).find((file) => file.endsWith(".tgz"))
  )
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
        "@types/node": "26.4.1",
        typescript: "7.0.2"
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
  for (const file of Object.keys(sourceHashes)) {
    copyFileSync(join(sources, file), join(consumer, file))
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
  run(
    "installed-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer
  )
  const sourcePaths = Object.fromEntries(
    Object.keys(JSON.parse(readFileSync(join(root, "package.json"))).exports)
      .filter((key) => key !== ".")
      .map((key) => [
        `effect-jobs/${key.slice(2)}`,
        [join(root, `src/${key.slice(2)}.ts`)]
      ])
  )
  writeFileSync(
    join(consumer, "tsconfig.source.json"),
    JSON.stringify({
      compilerOptions: {
        ...options,
        rootDir: root,
        noEmit: true,
        paths: {
          ...sourcePaths,
          "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
          "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*/index.d.ts")]
        }
      },
      include: ["*.ts"]
    })
  )
  run(
    "source-types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.source.json"],
    consumer
  )
  for (const fixture of ["Runtime.mjs", "DrizzlePrototypeRuntime.mjs"]) {
    writeFileSync(
      join(consumer, fixture),
      readFileSync(join(import.meta.dirname, fixture), "utf8").replaceAll(
        '"../../examples/docs/',
        '"./compiled/'
      )
    )
    for (const runtime of ["node", "bun"]) {
      run(`${fixture}-${runtime}`, runtime, [fixture], consumer)
    }
  }
  writeFileSync(join(work, "archive.sha256"), hash(readFileSync(archive)) + "\n")
} finally {
  const sourceUnchanged = Object.entries(sourceHashes).every(
    (entry) => hash(readFileSync(join(sources, entry[0]))) === entry[1]
  )
  writeFileSync(
    join(work, "receipt.json"),
    JSON.stringify(
      {
        sourceHashes,
        sourceUnchanged,
        results,
        postgres:
          "NotTested: no owned running PG; recording SQL boundary proves no DB atomicity/identity/Unknown COMMIT behavior",
        foreignDeclarations: "approved skipLibCheck:true; no declaration-C PASS"
      },
      null,
      2
    ) + "\n"
  )
  assert(sourceUnchanged)
  console.log(`Evidence: ${work}`)
}
