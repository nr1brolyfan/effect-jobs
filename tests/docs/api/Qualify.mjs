/**
 * Run: node tests/docs/api/Qualify.mjs (Node 24.15.0, Bun 1.4.2, frozen root install).
 * Extracts the actual JSDoc snippets; checks strict source/current packed types
 * and executable constructor/codec/empty-store portions. The parameterized join
 * example is typechecked only; PostgreSQL qualification uses separate gates.
 * Scratch consumers and receipt.json stay under ignored .toolchain/api-docs.
 * Optional one-time proof: append --comment-only-base <commit>. The default
 * qualification needs no historical Git objects; an explicitly requested base
 * must exist and have identical non-comment source tokens.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import * as ts from "typescript/unstable/ast"

const root = resolve(import.meta.dirname, "../../..")
const args = process.argv.slice(2)
assert(
  args.length === 0 ||
    (args.length === 2 && args[0] === "--comment-only-base" && args[1]),
  "Usage: node tests/docs/api/Qualify.mjs [--comment-only-base <commit>]"
)
const base = args[1] ?? null
const work = join(root, ".toolchain/api-docs")
mkdirSync(work, { recursive: true })
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const examples = []
const inventory = []
const sourceHashes = {}
const run = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    timeout: 60000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
const tokens = (source) => {
  const scanner = ts.createScanner(true, ts.LanguageVariant.Standard, source)
  const result = []
  const templates = []
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFile;
    token = scanner.scan()
  ) {
    if (token === ts.SyntaxKind.TemplateHead) {
      templates.push(0)
    } else if (templates.length > 0 && token === ts.SyntaxKind.OpenBraceToken) {
      templates[templates.length - 1]++
    } else if (templates.length > 0 && token === ts.SyntaxKind.CloseBraceToken) {
      if (templates.at(-1) === 0) {
        token = scanner.reScanTemplateToken(false)
        if (token === ts.SyntaxKind.TemplateTail) {
          templates.pop()
        }
      } else {
        templates[templates.length - 1]--
      }
    }
    result.push(scanner.getTokenText())
  }
  return result
}

for (const subpath of Object.keys(manifest.exports)) {
  const name = subpath === "." ? "index" : subpath.slice(2)
  const filename = `src/${name}.ts`
  const source = readFileSync(join(root, filename), "utf8")
  if (base !== null) {
    const original = run("git", ["show", `${base}:${filename}`])
    assert.deepEqual(
      tokens(source),
      tokens(original),
      `Non-comment source change: ${filename}`
    )
  }
  sourceHashes[filename] = createHash("sha256").update(source).digest("hex")
  const symbols = []
  for (const declaration of source.matchAll(
    /^export (?:const|class|interface|type|function) (\w+)/gm
  )) {
    const symbol = declaration[1]
    if (symbols.includes(symbol) && declaration[0].startsWith("export function")) {
      continue
    }
    const prefix = source.slice(0, declaration.index)
    assert(
      /\/\*\*(?:(?!\/\*\*|\*\/)[\s\S])*\*\/\s*$/.test(prefix),
      `${filename}:${symbol} lacks public JSDoc`
    )
    symbols.push(symbol)
  }
  if (name === "JobPayload") {
    symbols.push("protected")
  }
  if (name === "JobWorkerRuntime") {
    symbols.push("DrainResult", "DrainResults")
  }
  if (name === "JobWorker") {
    symbols.push(
      "JobWorkerConfigurationError",
      "JobWorkerNotReady",
      "JobWorkerUnavailable"
    )
  }
  inventory.push({ subpath, filename, symbols })
  for (const comment of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    if (!comment[0].includes("@example")) {
      continue
    }
    const body = comment[0].replace(/^\s*\* ?/gm, "")
    for (const match of body.matchAll(/```ts\n([\s\S]*?)```/g)) {
      examples.push({ name: `${name}.ts`, code: match[1] })
    }
  }
}
assert(examples.length === 9, "Expected the public constructor/codec/runtime examples")
const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  verbatimModuleSyntax: true,
  skipLibCheck: false,
  noEmit: true,
  allowImportingTsExtensions: true,
  types: ["node"]
}
const checks = `
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as Definition from "./Job.ts"
import * as Producer from "./JobProducer.ts"
import * as Consumer from "./JobConsumer.ts"
import * as Policy from "./JobPolicy.ts"
import * as Runtime from "./JobWorkerRuntime.ts"
import * as Storage from "./PostgreSqlSchema.ts"
import * as Payload from "./JobPayload.ts"
import * as Codec from "./JobPayloadCodec.ts"
import { ClaimResults, ClaimReconciliations, FinalizationResults, FinalizationReconciliations } from "effect-jobs/JobStore"
import type { JobStoreService } from "effect-jobs/JobStore"
assert.equal(Definition.definition.queue.name, "billing")
assert.equal(Producer.identity.operationId, "request-123")
assert.equal(Policy.policy.retrySchedule.delayMillis, 5000)
assert.equal(Policy.policy.completedRetention._tag, "Duration")
assert(Storage.ddl.includes('CREATE TABLE "app_jobs"."jobs"'))
assert(Payload.protectedValue)
assert.deepEqual(await Effect.runPromise(Codec.roundTrip), { amount: 1.5 })
const plan = await Effect.runPromise(Consumer.plan)
assert.equal(plan.consumers[0]?.localConcurrency, 2)
let claims = 0
const unused = () => Effect.die("empty-store example must not execute/finalize")
const store: JobStoreService = {
  claim: () => Effect.sync(() => { claims++; return ClaimResults.Empty() }),
  reconcileClaim: () => Effect.succeed(ClaimReconciliations.NotOwned()),
  release: () => Effect.succeed(FinalizationResults.Applied()),
  finalize: unused,
  reconcileFinalization: () => Effect.succeed(FinalizationReconciliations.OwnershipLost()),
  recoverExpired: () => Effect.succeed(0)
}
assert.equal(claims, 0)
assert.deepEqual(await Effect.runPromise(Runtime.runOnce(store)), { _tag: "Idle", claimed: 0, recovered: 0 })
assert.equal(claims, 1)
console.log("JSDoc constructor/codec/finite empty-store drain examples PASS")
`
// Fixed extraction order makes checks fail visibly if the example inventory changes.
assert.deepEqual(examples.map(({ name }) => name).sort(), [
  "Job.ts",
  "JobConsumer.ts",
  "JobPayload.ts",
  "JobPayloadCodec.ts",
  "JobPolicy.ts",
  "JobProducer.ts",
  "JobWorkerRuntime.ts",
  "PostgreSqlJobs.ts",
  "PostgreSqlSchema.ts"
])
const exportedNames = {
  Job: "definition",
  JobProducer: "identity",
  JobConsumer: "plan",
  JobPolicy: "policy",
  JobWorkerRuntime: "runOnce",
  PostgreSqlSchema: "ddl",
  JobPayload: "protectedValue",
  JobPayloadCodec: "roundTrip",
  PostgreSqlJobs: "enqueueInside"
}
const prepare = (directory, source, built = false) => {
  mkdirSync(directory, { recursive: true })
  for (const example of examples) {
    const binding = exportedNames[example.name.slice(0, -3)]
    let code = example.code.replace(
      new RegExp(`const ${binding}\\b`),
      `export const ${binding}`
    )
    if (source) {
      code = code.replace(
        /"effect-jobs\/([^"/]+)"/g,
        built ? '"../../../dist/$1.js"' : '"../../../src/$1.ts"'
      )
    }
    writeFileSync(join(directory, example.name), code)
  }
  writeFileSync(
    join(directory, "check.ts"),
    source
      ? checks.replace(
          /"effect-jobs\/([^"/]+)"/g,
          built ? '"../../../dist/$1.js"' : '"../../../src/$1.ts"'
        )
      : checks
  )
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({ compilerOptions, include: ["*.ts"] }, null, 2)
  )
}
const source = join(work, "source")
prepare(source, true)
writeFileSync(join(source, "package.json"), '{"type":"module","private":true}')
run("node", [
  join(root, "node_modules/typescript/bin/tsc"),
  "-p",
  join(source, "tsconfig.json")
])
run("bun", ["check.ts"], source)
run("bun", ["run", "build"])
const built = join(work, "built")
prepare(built, true, true)
writeFileSync(join(built, "package.json"), '{"type":"module","private":true}')
run("node", ["check.ts"], built)
if (!process.env.EFFECT_JOBS_ARCHIVE) {
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", work])
}
const installed = join(work, "packed")
prepare(installed, false)
writeFileSync(
  join(installed, "package.json"),
  JSON.stringify(
    {
      type: "module",
      private: true,
      dependencies: {
        "effect-jobs": `file:${process.env.EFFECT_JOBS_ARCHIVE ?? join(work, "effect-jobs-0.1.0-alpha.0.tgz")}`,
        effect: "4.0.0",
        typescript: "7.0.2",
        "@types/node": "26.4.1"
      }
    },
    null,
    2
  )
)
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], installed)
const packedManifest = JSON.parse(
  readFileSync(join(installed, "node_modules/effect-jobs/package.json"), "utf8")
)
assert.equal(packedManifest.version, "0.1.0-alpha.0")
assert.equal(packedManifest.peerDependencies.effect, "4.0.0")
assert.equal(packedManifest.peerDependencies["drizzle-orm"], "1.0.0-rc.5-169397b")
assert(
  !readdirSync(join(installed, "node_modules")).includes("drizzle-orm"),
  "Core examples must retain absent optional peer"
)
run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], installed)
for (const runtime of ["node", "bun"]) {
  run(runtime, ["check.ts"], installed)
}
const receipt = {
  base,
  inventory,
  sourceHashes,
  examples: examples.map(({ name }) => name),
  commentOnlySource:
    base === null ? "NotTested (no baseline requested)" : "PASS token equality",
  sourceTypes: "PASS skipLibCheck:false",
  sourceRuntime: "PASS Node+Bun",
  packedTypes: "PASS skipLibCheck:false",
  packedRuntime: "PASS Node+Bun",
  packedVersion: packedManifest.version,
  effectVersion: packedManifest.peerDependencies.effect,
  optionalDrizzle: "ABSENT for core examples",
  limitations:
    "Empty test store proves finite drain/composition only; no PostgreSQL atomicity or handler delivery qualification. Drizzle upstream declarations remain separately limited."
}
writeFileSync(join(work, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
console.log(
  `9 extracted JSDoc examples: source and current packed strict types, Node/Bun runtime PASS; ${inventory.length} subpaths inventoried`
)
