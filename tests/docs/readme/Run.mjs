// Extract every visible fence; exact bytes are never silently skipped.
import {
  checkInstalledGraph,
  drizzleSource
} from "../../qualification/DrizzleSnapshot.mjs"
import { names as regressionNames, wrap } from "./Prelude.mjs"
import { fences, modules as visibleModules, names as visibleNames } from "./Visible.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { join, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { publicModules } from "../../../scripts/SourceExports.mjs"
const root = fileURLToPath(new URL("../../../", import.meta.url))
assert.equal(process.version, "v24.15.0")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const modules = new Map(publicModules(manifest).map((module) => [module.name, module]))
const readme = readFileSync(join(root, "README.md"), "utf8")
const blocks = fences(readme)
const visible = visibleModules(blocks.filter((m) => m[1] === "ts").map((m) => m[2]))
const regression = fences(
  readFileSync(join(import.meta.dirname, "Regression.md"), "utf8")
)
assert(regression.every((m) => m[1] === "ts"))
assert.equal(
  regression.length,
  regressionNames.length,
  "Update the regression fence inventory"
)
const effectPin = manifest.peerDependencies.effect
const [bunCommand] = blocks.filter((m) => m[1] === "sh").map((m) => m[2].trim())
assert.equal(blocks.filter((m) => m[1] === "sh").length, 1)
assert.equal(bunCommand, `bun add --exact effect-jobs@alpha effect@${effectPin}`)
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
let bunConsumer
try {
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
  bunConsumer = mkdtempSync(join(tmpdir(), "effect-jobs-readme-bun-"))
  writeFileSync(join(bunConsumer, "package.json"), '{"private":true,"type":"module"}\n')
  const [, ...bunArgs] = bunCommand.split(" ")
  run(
    "bun-add",
    "bun",
    bunArgs.map((arg) => (arg === "effect-jobs@alpha" ? archive : arg)),
    bunConsumer
  )
  const bunLock = join(bunConsumer, "bun.lock")
  const initialLock = readFileSync(bunLock)
  rmSync(join(bunConsumer, "node_modules"), { recursive: true })
  run("bun-frozen", "bun", ["install", "--frozen-lockfile"], bunConsumer)
  assert.deepEqual(readFileSync(bunLock), initialLock)
  run("bun-tree", "bun", ["pm", "ls", "--all"], bunConsumer)
  run(
    "bun-resolution",
    "bun",
    [
      "-e",
      `
import assert from "node:assert/strict"
import { realpathSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
const json = (path) => JSON.parse(readFileSync(path, "utf8"))
const dependencies = json("package.json").dependencies
const lock = Bun.JSONC.parse(readFileSync("bun.lock", "utf8"))
assert.deepEqual(Object.keys(dependencies).sort(), ["effect", "effect-jobs"])
assert.equal(dependencies["effect-jobs"], ${JSON.stringify(archive)})
assert.equal(dependencies.effect, ${JSON.stringify(effectPin)})
assert.deepEqual(lock.workspaces[""].dependencies, dependencies)
assert.equal(lock.packages.effect[0], ${JSON.stringify(`effect@${effectPin}`)})
assert(!Object.entries(lock.packages).some(([name, [locator]]) =>
  name.split("/").includes("drizzle-orm") || locator.startsWith("drizzle-orm@")
))
const archiveIntegrity = "sha512-" + createHash("sha512").update(readFileSync(dependencies["effect-jobs"])).digest("base64")
assert.equal(lock.packages["effect-jobs"].at(-1), archiveIntegrity)
const jobsPath = fileURLToPath(import.meta.resolve("effect-jobs/Job"))
const effectPath = fileURLToPath(import.meta.resolve("effect"))
assert.equal(realpathSync(Bun.resolveSync("effect", dirname(jobsPath))), realpathSync(effectPath))
assert.throws(() => import.meta.resolve("drizzle-orm"))
assert.throws(() => Bun.resolveSync("drizzle-orm", dirname(jobsPath)))
for (const [name, entry, version] of ${JSON.stringify([
        ["effect-jobs", "effect-jobs/Job", manifest.version],
        ["effect", "effect", effectPin]
      ])}) {
  const packagePath = realpathSync("node_modules/" + name)
  const resolved = import.meta.resolve(entry)
  assert(realpathSync(new URL(resolved)).startsWith(packagePath + "/"))
  assert.equal(json(packagePath + "/package.json").version, version)
  await import(entry)
  console.log(JSON.stringify({ name, resolved, version }))
}
assert.equal(Bun.version, "1.4.2")
`
    ],
    bunConsumer
  )
  assert(!existsSync(join(bunConsumer, "node_modules/drizzle-orm")))
  assert.equal(
    readFileSync(join(bunConsumer, "node_modules/effect-jobs/README.md"), "utf8"),
    readme
  )

  const consumer = join(evidence, "packed")
  mkdirSync(consumer)
  const consumerManifest = join(consumer, "package.json")
  const consumerLock = join(consumer, "package-lock.json")
  writeFileSync(consumerManifest, '{"private":true,"type":"module"}\n')
  const npmFlags = ["--ignore-scripts", "--no-audit", "--no-fund"]
  const npmStages = [
    { stage: "core", inputs: [archive, `effect@${effectPin}`] },
    { stage: "drizzle", inputs: [drizzleSource] }
  ]
  for (const { stage, inputs } of npmStages) {
    run(
      `npm-${stage}-install`,
      "npm",
      ["install", "--save-exact", ...inputs, ...npmFlags],
      consumer
    )
    const dependencies = JSON.parse(readFileSync(consumerManifest, "utf8")).dependencies
    const { packages } = JSON.parse(readFileSync(consumerLock, "utf8"))
    assert.equal(dependencies.effect, effectPin)
    assert.deepEqual(packages[""].dependencies, dependencies)
    assert.equal(packages["node_modules/effect"].version, effectPin)
    if (stage === "core") {
      assert.equal(dependencies["drizzle-orm"], undefined)
      assert(
        !Object.keys(packages).some((path) => path.endsWith("node_modules/drizzle-orm"))
      )
      assert(!existsSync(join(consumer, "node_modules/drizzle-orm")))
      run(
        "npm-core-frozen-install",
        "npm",
        ["ci", "--strict-peer-deps", ...npmFlags],
        consumer
      )
      assert(!existsSync(join(consumer, "node_modules/drizzle-orm")))
    } else {
      assert.equal(dependencies["drizzle-orm"], drizzleSource)
      run(
        "npm-drizzle-frozen-install",
        "npm",
        ["ci", "--strict-peer-deps", ...npmFlags],
        consumer
      )
      checkInstalledGraph(consumer)
    }
    copyFileSync(consumerManifest, join(evidence, `${stage}-package.json`))
    copyFileSync(consumerLock, join(evidence, `${stage}-package-lock.json`))
  }

  // Add snippet tooling after the consumer installs have been qualified.
  run(
    "snippet-dependencies",
    "npm",
    [
      "install",
      "--save-exact",
      ...npmFlags,
      `@effect/sql-pg@${manifest.devDependencies["@effect/sql-pg"]}`,
      `@effect/platform-node@${manifest.devDependencies["@effect/platform-node"]}`,
      `@effect/platform-node-shared@${manifest.devDependencies["@effect/platform-node-shared"]}`,
      "typescript@7.0.2",
      "@types/node@26.4.1"
    ],
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
  // The binding uses the workspace's frozen Alchemy graph. Keep it out of the
  // independent npm core and Drizzle consumers.
  const cloudflarePath = join(root, "node_modules/@alchemy.run/cloudflare")
  const cloudflare = JSON.parse(
    readFileSync(join(cloudflarePath, "package.json"), "utf8")
  )
  assert.equal(cloudflare.version, manifest.overrides["@alchemy.run/cloudflare"])
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
      "@alchemy.run/cloudflare": [join(cloudflarePath, cloudflare.exports["."].types)]
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
        ? code.replace(/"effect-jobs\/([^"/]+)"/g, (_, module) => {
            const entry = modules.get(module)
            assert(entry, `Unknown public module: ${module}`)
            return JSON.stringify(
              relative(directory, join(root, entry.source)).replace(/\.ts$/, ".js")
            )
          })
        : code
    for (const [i, name] of regressionNames.entries()) {
      writeFileSync(join(directory, `${name}.ts`), replace(wrap(name, regression[i][2])))
    }
    for (const [name, code] of Object.entries(visible)) {
      writeFileSync(join(directory, `${name}.ts`), replace(code))
    }
    for (const file of ["Fixture", "Smoke"]) {
      writeFileSync(
        join(directory, `${file}.ts`),
        replace(readFileSync(join(root, `tests/docs/readme/${file}.ts.txt`), "utf8"))
      )
    }
    const resolvedPaths =
      label === "source"
        ? {
            ...options.paths,
            "effect/Schema": [join(root, "node_modules/effect/dist/Schema.d.ts")],
            "drizzle-orm": [join(root, "node_modules/drizzle-orm/index.d.ts")],
            "drizzle-orm/*": [join(root, "node_modules/drizzle-orm/*.d.ts")]
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
            "node-worker.ts",
            "native.ts",
            "Smoke.ts",
            "VisiblePostgres.ts",
            "VisibleSqliteBinding.ts"
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
        bunLockSha256: hash(initialLock),
        archiveSha256: hash(readFileSync(archive)),
        version: installed.version,
        packedLockSha256: hash(readFileSync(join(consumer, "package-lock.json")))
      },
      null,
      2
    )
  )
} finally {
  if (bunConsumer) {
    for (const file of ["package.json", "bun.lock"]) {
      const input = join(bunConsumer, file)
      if (existsSync(input)) {
        copyFileSync(input, join(evidence, `bun-${file}`))
      }
    }
    rmSync(bunConsumer, { recursive: true })
  }
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
        fences: blocks.map((m) => ({
          language: m[1],
          sha256: hash(m[2]),
          scope:
            m[1] === "ts"
              ? "source/packed type checking against the enclosing contexts"
              : "fresh Bun add, frozen lock and installed resolution"
        })),
        snippets: visibleNames,
        regressionSnippets: regressionNames,
        runtimeScopes: {
          "Node+Bun regression fixture execution": regressionNames.filter(
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
          overview: "expected application manager rejection (no connection fixture)",
          migration:
            "DDL/setup declarations plus explicit expected readiness failure without app SQL"
        },
        results,
        sourceInputs: inputs(join(root, "src")),
        qualifierInputs: inputs(join(root, "tests/docs/readme")),
        limits:
          "README fixtures cover portable library composition. Alchemy source/bridge/callback/PG has a separate pinned example gate; hosted deployment NotTested. Drizzle skipLibCheck:true; strict non-Drizzle check separate. Fixture runtime is composition/crypto/handlers, not real SQL."
      },
      null,
      2
    ) + "\n"
  )
  console.log(`README evidence: ${evidence}`)
}
