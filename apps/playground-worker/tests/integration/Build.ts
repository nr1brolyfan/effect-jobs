// Explicit local build FFI. Library remains packed independently of private apps.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../..")
const evidence = resolve(
  root,
  process.env.PLAYGROUND_EVIDENCE_DIRECTORY ?? ".multica/integration"
)
mkdirSync(evidence, { recursive: true })
const run = (label: string, args: ReadonlyArray<string>) => {
  const at = new Date().toISOString()
  try {
    const output = execFileSync(args[0]!, args.slice(1), {
      cwd: root,
      timeout: 600000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
    writeFileSync(`${evidence}/${label}.log`, output)
    return { label, at, exit: 0, output }
  } catch (error) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string }
    writeFileSync(
      `${evidence}/${label}.log`,
      String(failure.stdout ?? "") + String(failure.stderr ?? "")
    )
    throw new Error(`${label} failed`)
  }
}
const commands = [
  run("library-build", ["bun", "run", "build"]),
  run("refresh-file-dependency", [
    "bun",
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--force"
  ]),
  run("apps-build", ["bun", "run", "playground:build"]),
  run("apps-types", ["bun", "run", "playground:check"])
]
run("fixture-bundle", [
  "node_modules/.bin/esbuild",
  "apps/playground-worker/tests/integration/Admit.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:node:*",
  `--outfile=${evidence}/Admit.mjs`
])
run("migration-bundle", [
  "node_modules/.bin/esbuild",
  "apps/playground-worker/tests/integration/SchemaEntry.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:effect",
  "--external:effect/*",
  "--external:effect-jobs/*",
  `--outfile=${evidence}/Migrations.mjs`
])
for (const name of ["OperatorProbe", "NativeDrizzleOperators", "QuotaProbe"]) {
  run(`${name}-bundle`, [
    "node_modules/.bin/esbuild",
    `apps/playground-worker/tests/integration/${name}.ts`,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--external:node:*",
    "--external:effect",
    "--external:effect/*",
    "--external:effect-jobs/*",
    `--outfile=${evidence}/${name}.mjs`
  ])
}
process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY = mkdtempSync(`${evidence}/artifact-`)
const packed = run("pack", ["node", "scripts/pack-release.mjs"]).output.trim()
delete process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY
const inventory = run("inventory", ["tar", "-tzf", packed]).output.split("\n")
if (inventory.some((path) => /package\/(apps|packages|node_modules)\//.test(path))) {
  throw new Error("Private app leaked into library")
}
for (const path of inventory.filter(
  (p) => p.startsWith("package/dist/") && !p.endsWith("/")
)) {
  const actual = execFileSync("tar", ["-xOf", packed, path], { timeout: 60000 })
  if (!actual.equals(readFileSync(resolve(root, path.slice(8))))) {
    throw new Error("Packed byte mismatch")
  }
}
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")
const pointer = JSON.parse(
  readFileSync(`${root}/apps/playground-worker/dist/native.json`, "utf8")
) as { directory: string }
const nativeManifest = resolve(pointer.directory, "manifest.json")
const receipt = {
  at: new Date().toISOString(),
  commands: commands.map((command) => ({
    label: command.label,
    at: command.at,
    exit: command.exit
  })),
  archive: packed,
  archiveSha256: hash(packed),
  nativeManifestSha256: hash(nativeManifest),
  nativeManifest,
  testHostSourceSha256: hash(
    `${root}/apps/playground-worker/tests/integration/TestWorker.ts`
  ),
  operatorProbeSha256: hash(`${evidence}/OperatorProbe.mjs`),
  nativeDrizzleOperatorsSha256: hash(`${evidence}/NativeDrizzleOperators.mjs`),
  fixtureSha256: hash(`${evidence}/Admit.mjs`),
  quotaProbeSha256: hash(`${evidence}/QuotaProbe.mjs`),
  migrationSha256: hash(`${evidence}/Migrations.mjs`),
  nativeHostRuntime: execFileSync(
    "node",
    [
      "-e",
      "console.log(require('@alchemy.run/cloudflare-runtime/package.json').version)"
    ],
    { cwd: root, encoding: "utf8" }
  ).trim(),
  cssSha256: hash(`${root}/apps/playground/dist/Jobs.css`),
  clientSha256: hash(`${root}/apps/playground/dist/Client.js`),
  node: process.version,
  bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim()
}
writeFileSync(`${evidence}/build-receipt.json`, JSON.stringify(receipt, null, 2) + "\n")
console.log(JSON.stringify(receipt))
