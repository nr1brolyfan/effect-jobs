// Extract every visible fence; exact bytes are never silently skipped.
import { names, wrap } from "./Prelude.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../../../", import.meta.url))
assert.equal(process.version, "v24.15.0")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const readme = readFileSync(join(root, "README.md"), "utf8")
const fences = [...readme.matchAll(/```(\w+)\n([\s\S]*?)```/g)]
assert(fences.every((m) => ["ts", "sh", "text"].includes(m[1])))
const snippets = fences.filter((m) => m[1] === "ts").map((m) => m[2])
assert.equal(snippets.length, names.length, "Update the complete fence inventory")
assert.equal(fences.filter((m) => m[1] === "sh").length, 1)
assert.equal(fences.filter((m) => m[1] === "text").length, 1)
assert.equal(
  fences.find((m) => m[1] === "sh")[2].trim(),
  `npm install effect-jobs@${manifest.version} effect@4.0.0`
)
const hash = (value) => createHash("sha256").update(value).digest("hex")
mkdirSync(join(root, ".toolchain/readme"), { recursive: true })
const evidence = mkdtempSync(join(root, ".toolchain/readme/run-"))
const results = []
const run = (name, cmd, args, cwd) => {
  const r = spawnSync(cmd, args, {
    cwd,
    timeout: 120000,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  })
  writeFileSync(join(evidence, `${name}.log`), (r.stdout ?? "") + (r.stderr ?? ""))
  results.push({ name, cmd, args, status: r.status })
  assert.equal(r.status, 0, `${name} failed: ${join(evidence, `${name}.log`)}`)
}
const alchemy = process.env.EFFECT_JOBS_ALCHEMY_DIRECTORY
  ? resolve(process.env.EFFECT_JOBS_ALCHEMY_DIRECTORY)
  : join(evidence, "alchemy")
if (!process.env.EFFECT_JOBS_ALCHEMY_DIRECTORY) {
  mkdirSync(alchemy)
  writeFileSync(
    join(alchemy, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { alchemy: "2.0.0-beta.81", effect: "4.0.0" },
      overrides: { "@effect/sql-d1": "4.0.0", "@effect/sql-sqlite-do": "4.0.0" }
    }) + "\n"
  )
}
try {
  if (!process.env.EFFECT_JOBS_ALCHEMY_DIRECTORY) {
    run(
      "alchemy-install",
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=optional"],
      alchemy
    )
  }
  const alchemyManifest = JSON.parse(
    readFileSync(join(alchemy, "node_modules/alchemy/package.json"))
  )
  assert.equal(alchemyManifest.version, "2.0.0-beta.81")
  const declarations = [
    "lib/Callback.d.ts",
    "lib/Cloudflare/Workers/DurableObject.d.ts",
    "lib/Cloudflare/Workers/Worker.d.ts",
    "lib/Stack.d.ts"
  ]
  writeFileSync(
    join(evidence, "alchemy-inputs.json"),
    JSON.stringify(
      {
        version: alchemyManifest.version,
        lockSha256: hash(readFileSync(join(alchemy, "package-lock.json"))),
        declarations: declarations.map((path) => ({
          path,
          sha256: hash(readFileSync(join(alchemy, "node_modules/alchemy", path)))
        }))
      },
      null,
      2
    )
  )
  let archive = process.argv[2] ?? process.env.EFFECT_JOBS_ARCHIVE
  if (!archive) {
    run(
      "pack-current",
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", evidence],
      root
    )
    archive = join(evidence, `${manifest.name}-${manifest.version}.tgz`)
  }
  archive = resolve(archive)
  const consumer = join(evidence, "packed")
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.0.0",
        "drizzle-orm": "1.0.0-rc.5-169397b",
        "@effect/sql-pg": "4.0.0",
        "@effect/platform-node": "4.0.0",
        typescript: "7.0.2",
        "@types/node": "26.4.1"
      },
      overrides: { "@effect/platform-node-shared": "4.0.0" }
    }) + "\n"
  )
  run(
    "packed-install",
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer
  )
  run("packed-peers", "npm", ["ls", "--all"], consumer)
  const installed = JSON.parse(
    readFileSync(join(consumer, "node_modules/effect-jobs/package.json"))
  )
  assert.equal(installed.version, manifest.version)
  assert.equal(
    readFileSync(join(consumer, "node_modules/effect-jobs/README.md"), "utf8"),
    readme,
    "Packed README must equal qualified source"
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
    types: ["node"],
    paths: {
      alchemy: [join(alchemy, "node_modules/alchemy/lib/index.d.ts")],
      "alchemy/Cloudflare": [
        join(alchemy, "node_modules/alchemy/lib/Cloudflare/index.d.ts")
      ]
    }
  }
  const source = join(consumer, "source")
  mkdirSync(source)
  for (const [label, directory] of [
    ["source", source],
    ["packed", consumer]
  ]) {
    const replace = (code) =>
      label === "source"
        ? code.replace(/"effect-jobs\/([^"/]+)"/g, (_, module) =>
            JSON.stringify(`${relative(directory, join(root, "src", module))}.js`)
          )
        : code
    for (const [i, name] of names.entries()) {
      writeFileSync(join(directory, `${name}.ts`), replace(wrap(name, snippets[i])))
    }
    for (const file of ["Fixture", "Smoke"]) {
      writeFileSync(
        join(directory, `${file}.ts`),
        replace(readFileSync(join(root, `tests/docs/readme/${file}.ts.txt`), "utf8"))
      )
    }
    const code = `import { Codes } from "./codes.js"\n`
    // Failure example shares the exact preceding catalog.
    const failurePath = join(directory, "failures.ts")
    writeFileSync(failurePath, code + readFileSync(failurePath, "utf8"))
    const resolvedPaths =
      label === "source"
        ? {
            ...options.paths,
            "effect/Schema": [join(root, "node_modules/effect/dist/Schema.d.ts")],
            "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
            "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*/index.d.ts")]
          }
        : options.paths
    const config = {
      compilerOptions: {
        ...options,
        paths: resolvedPaths,
        rootDir: label === "source" ? root : directory,
        outDir: "compiled"
      },
      include: ["*.ts"]
    }
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify(config, null, 2))
    writeFileSync(
      join(directory, "tsconfig.strict.json"),
      JSON.stringify(
        {
          extends: "./tsconfig.json",
          compilerOptions: { skipLibCheck: false, noEmit: true },
          exclude: [
            "drizzle.ts",
            "indexes.ts",
            "cloud-*.ts",
            "node-worker.ts",
            "native.ts",
            "Smoke.ts"
          ]
        },
        null,
        2
      )
    )
    run(
      `${label}-types`,
      "node",
      [join(consumer, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      directory
    )
    run(
      `${label}-strict`,
      "node",
      [join(consumer, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.strict.json"],
      directory
    )
    const compiled =
      label === "source"
        ? join(directory, "compiled", relative(root, directory))
        : join(directory, "compiled")
    for (const runtime of ["node", "bun"]) {
      run(`${label}-${runtime}`, runtime, ["Smoke.js"], compiled)
    }
  }
  writeFileSync(
    join(evidence, "artifact-input.json"),
    JSON.stringify(
      {
        archiveSha256: hash(readFileSync(archive)),
        version: installed.version,
        packedLockSha256: hash(readFileSync(join(consumer, "package-lock.json")))
      },
      null,
      2
    )
  )
} finally {
  const inputs = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? inputs(join(dir, e.name))
        : [
            {
              path: relative(root, join(dir, e.name)),
              sha256: hash(readFileSync(join(dir, e.name)))
            }
          ]
    )
  writeFileSync(
    join(evidence, "receipt.json"),
    JSON.stringify(
      {
        node: process.version,
        readmeSha256: hash(readme),
        fences: fences.map((m) => ({
          language: m[1],
          sha256: hash(m[2]),
          scope:
            m[1] === "ts"
              ? "source/packed declarations; see explicit runtime scopes"
              : m[1] === "sh"
                ? "candidate version/command assertion; registry installation deferred until publication"
                : "conceptual topology, no executable claim"
        })),
        snippets: names,
        runtimeScopes: {
          "Node+Bun fixture execution": names.filter(
            (name) =>
              ![
                "node-worker",
                "bounded",
                "native",
                "cloud-consumer",
                "cloud-application",
                "cloud-stack"
              ].includes(name)
          ),
          "node-worker":
            "declarations; actual persistent Node main invocation NotTested by README harness; portable scoped worker qualification separate",
          bounded: "declarations plus actual finite worker drain harness",
          native: "declarations; real native transaction source/installed gate separate",
          "cloud-consumer":
            "installed Alchemy declarations only; external PG/callback execution NotTested",
          "cloud-application":
            "installed Alchemy declarations only; RPC/wake/external PG NotTested",
          "cloud-stack": "installed Alchemy declarations only; deployment NotTested",
          overview: "expected application manager rejection (no connection fixture)",
          migration:
            "DDL/setup declarations plus explicit expected readiness failure without app SQL"
        },
        results,
        sourceInputs: inputs(join(root, "src")),
        qualifierInputs: inputs(join(root, "tests/docs/readme")),
        limits:
          "Cloudflare external PG/deployment NotTested; exact installed Alchemy declarations only, with separate optional-peer tree. Drizzle skipLibCheck:true; strict non-Drizzle check separate. Fixture runtime is composition/crypto/handlers, not real SQL."
      },
      null,
      2
    ) + "\n"
  )
  console.log(`README evidence: ${evidence}`)
}
