// Extract every README TypeScript fence; no manually maintained snippet copies.
// Run: node tests/docs/readme/Run.mjs [absolute immutable archive]
// Checks source + current packed artifact; no historical-alpha compatibility claim.
import { wrap } from "./Prelude.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const readme = readFileSync(join(root, "README.md"), "utf8")
const snippets = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1])
const names = [
  "billing",
  "migration",
  "drizzle",
  "transaction",
  "policy",
  "encrypted",
  "protection"
]
assert.equal(
  snippets.length,
  names.length,
  "Update the extraction map when fences change"
)
assert.equal(process.version, "v24.15.0")
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
mkdirSync(join(root, ".toolchain/readme"), { recursive: true })
const evidence = mkdtempSync(join(root, ".toolchain/readme/run-"))
const results = []
const installed = []
const inputFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? inputFiles(path)
      : [{ path: relative(root, path), sha256: sha256(readFileSync(path)) }]
  })
const run = (name, command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    timeout: 60000,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  })
  writeFileSync(
    join(evidence, `${name}.log`),
    (result.stdout ?? "") + (result.stderr ?? "")
  )
  results.push({ name, command, args, status: result.status })
  assert.equal(result.status, 0, `${name}: see ${join(evidence, `${name}.log`)}`)
}
const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  verbatimModuleSyntax: true,
  skipLibCheck: true,
  types: ["node"]
}
const prepare = (directory, source) => {
  mkdirSync(directory, { recursive: true })
  for (const [index, name] of names.entries()) {
    const wrapped = wrap(name, snippets[index])
    const code = source
      ? wrapped.replace(/"effect-jobs\/([^"/]+)"/g, (_, module) =>
          JSON.stringify(`${relative(directory, join(root, "src", module))}.js`)
        )
      : wrapped
    writeFileSync(join(directory, `${name}.ts`), code)
  }
  const smokeCode = readFileSync(smoke, "utf8")
  writeFileSync(
    join(directory, "Smoke.ts"),
    source
      ? smokeCode.replace(/"effect-jobs\/([^"/]+)"/g, (_, module) =>
          JSON.stringify(`${relative(directory, join(root, "src", module))}.js`)
        )
      : smokeCode
  )
  const contracts = `import { Effect } from "effect"
import { billing } from "./billing.js"
import type { ApplicationAdapter } from "effect-jobs/PostgreSqlTransaction"
declare const adapter: ApplicationAdapter
const application = billing(adapter, () => Effect.void)
const closed = <A, E>(effect: Effect.Effect<A, E, never>) => effect
closed(application.enqueue("operation-1", "invoice-1"))
closed(application.drain)
`
  writeFileSync(
    join(directory, "Contracts.ts"),
    source
      ? contracts.replace(
          '"effect-jobs/PostgreSqlTransaction"',
          JSON.stringify(
            `${relative(directory, join(root, "src/PostgreSqlTransaction"))}.js`
          )
        )
      : contracts
  )
  const outDir = join(directory, "compiled")
  const config = {
    compilerOptions: {
      ...compilerOptions,
      rootDir: source ? root : directory,
      outDir
    },
    include: ["*.ts"]
  }
  // Root's qualified Drizzle resolution is needed for the source consumer too.
  if (source) {
    config.compilerOptions.paths = {
      "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
      "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*/index.d.ts")]
    }
  }
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify(config, null, 2) + "\n")
  // Preserve strict checking for the non-Drizzle subset as a separate gate.
  writeFileSync(
    join(directory, "tsconfig.strict.json"),
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { skipLibCheck: false, noEmit: true },
        exclude: ["drizzle.ts", "Smoke.ts"]
      },
      null,
      2
    ) + "\n"
  )
  const compiled = source ? join(outDir, relative(root, directory)) : outDir
  return { compiled }
}
const smoke = fileURLToPath(new URL("Smoke.ts.txt", import.meta.url))
const check = (label, directory, compiled, compiler) => {
  run(`${label}-types`, "node", [compiler, "-p", "tsconfig.json"], directory)
  run(`${label}-strict`, "node", [compiler, "-p", "tsconfig.strict.json"], directory)
  for (const runtime of ["node", "bun"]) {
    run(`${label}-${runtime}`, runtime, ["Smoke.js"], compiled)
  }
}
try {
  const source = join(evidence, "source")
  const { compiled } = prepare(source, true)
  // ESM resolution uses root's own, frozen dependency tree.
  writeFileSync(join(source, "package.json"), '{"type":"module","private":true}\n')
  check("source", source, compiled, join(root, "node_modules/typescript/bin/tsc"))
  let archive = process.argv[2] ?? process.env.EFFECT_JOBS_ARCHIVE
  if (!archive) {
    run(
      "pack-current",
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", evidence],
      root
    )
    archive = join(evidence, "effect-jobs-0.1.0-alpha.0.tgz")
  }
  const targets = [["packed", `file:${resolve(archive)}`]]
  for (const [label, target] of targets) {
    const directory = join(evidence, label)
    const { compiled: output } = prepare(directory, false)
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: {
            "effect-jobs": target,
            effect: "4.0.0",
            "drizzle-orm": "1.0.0-rc.5-169397b",
            typescript: "7.0.2",
            "@types/node": "26.4.1"
          }
        },
        null,
        2
      ) + "\n"
    )
    run(
      `${label}-install`,
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      directory
    )
    run(`${label}-peers`, "npm", ["ls", "--all"], directory)
    // Separate absent-peer probe imports every non-Drizzle public module.
    const manifest = JSON.parse(
      readFileSync(join(directory, "node_modules/effect-jobs/package.json"), "utf8")
    )
    assert.equal(manifest.version, "0.1.0-alpha.0")
    installed.push({
      label,
      version: manifest.version,
      lockSha256: sha256(readFileSync(join(directory, "package-lock.json")))
    })
    check(label, directory, output, join(directory, "node_modules/typescript/bin/tsc"))
    const isolated = mkdtempSync(join(resolve(root, ".."), ".readme-absent-"))
    writeFileSync(
      join(isolated, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "effect-jobs": target, effect: "4.0.0" }
      }) + "\n"
    )
    run(
      `${label}-absent-install`,
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      isolated
    )
    writeFileSync(
      join(isolated, "inert.mjs"),
      `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
for (const peer of ["pg", "drizzle-orm"]) assert.throws(() => require.resolve(peer))
const timers = [globalThis.setTimeout, globalThis.setInterval]
const forbidden = () => { throw new Error("import started work") }
globalThis.setTimeout = globalThis.setInterval = forbidden
try {
  for (const path of ${JSON.stringify(Object.keys(manifest.exports).filter((path) => path !== "./PostgreSqlDrizzleSchema"))}) {
    await import(path === "." ? "effect-jobs" : "effect-jobs/" + path.slice(2))
  }
} finally {
  [globalThis.setTimeout, globalThis.setInterval] = timers
}
console.log("All non-Drizzle imports without optional peers: PASS")
`
    )
    for (const runtime of ["node", "bun"]) {
      run(`${label}-absent-${runtime}`, runtime, ["inert.mjs"], isolated)
    }
  }
} finally {
  writeFileSync(
    join(evidence, "receipt.json"),
    JSON.stringify(
      {
        readmeSha256: sha256(readme),
        snippetSha256: snippets.map(sha256),
        runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
        smokeSha256: sha256(readFileSync(smoke)),
        preludeSha256: sha256(readFileSync(new URL("Prelude.mjs", import.meta.url))),
        node: process.version,
        sourceInputs: inputFiles(join(root, "src")),
        configurationInputs: [
          "package.json",
          "bun.lock",
          "tsconfig.json",
          "tsconfig.build.json",
          ".oxlintrc.json",
          ".oxfmtrc.json"
        ].map((path) => ({ path, sha256: sha256(readFileSync(join(root, path))) })),
        installed,
        archiveSha256: process.argv[2]
          ? sha256(readFileSync(resolve(process.argv[2])))
          : null,
        snippets: names,
        results,
        limits:
          "Composition/codec/handler/worker harness checks; no real PostgreSQL transaction qualification. Drizzle uses skipLibCheck:true; strict non-Drizzle check separate."
      },
      null,
      2
    ) + "\n"
  )
  console.log(`README evidence: ${evidence}`)
}
