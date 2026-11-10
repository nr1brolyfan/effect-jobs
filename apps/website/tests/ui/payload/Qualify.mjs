// Synchronous bounded evidence collector. Failing/deferred gates stay explicit.
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const root = resolve(import.meta.dirname, "../../../../..")
const output = resolve(root, ".multica/payload-evidence")
mkdirSync(output, { recursive: true })
const owned = [
  ...readdirSync(resolve(root, "apps/website/src/features/jobs/payload")).map(
    (path) => `apps/website/src/features/jobs/payload/${path}`
  ),
  ...readdirSync(import.meta.dirname)
    .filter((path) => !path.startsWith("."))
    .map((path) => `apps/website/tests/ui/payload/${path}`),
  "packages/playground-contracts/src/SyntheticCryptoFixture.ts",
  "packages/playground-contracts/tests/SyntheticCryptoFixture.test.ts"
]
const hash = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")
const inputs = Object.fromEntries(
  [
    ...owned,
    "bun.lock",
    "package.json",
    "tsconfig.playground.json",
    ".oxlintrc.json",
    ".oxfmtrc.json"
  ].map((path) => [path, hash(path)])
)
const run = (name, command, scope) => {
  const start = Date.now()
  let exit = 0,
    stdout = "",
    stderr = ""
  try {
    stdout = execFileSync(command[0], command.slice(1), {
      cwd: root,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    })
  } catch (error) {
    exit = error.status ?? -1
    stdout = String(error.stdout ?? "")
    stderr = String(error.stderr ?? "")
  }
  const log = stdout + stderr
  writeFileSync(resolve(output, `${name}.log`), log.slice(0, 65536))
  const result = {
    name,
    command,
    scope,
    exit,
    millis: Date.now() - start,
    logClipped: log.length > 65536
  }
  console.log(JSON.stringify(result))
  return result
}
const commands = [
  [
    "fixture-tests",
    [
      "node_modules/.bin/vitest",
      "run",
      "packages/playground-contracts/tests/SyntheticCryptoFixture.test.ts"
    ],
    "isolated real crypto"
  ],
  ["playground-tests", ["bun", "run", "playground:test"], "contracts unit suites"],
  [
    "isolated-types",
    ["node_modules/.bin/tsc", "-p", "apps/website/tests/ui/payload/tsconfig.json"],
    "test-only future DTO shape and paths; not real shared registration"
  ],
  [
    "fixture-build",
    ["bun", "run", "--filter", "@effect-jobs/playground-contracts", "build"],
    "real contracts package"
  ],
  [
    "playground-build",
    ["bun", "run", "playground:build"],
    "current production entry; panel not registered in entry"
  ],
  [
    "playground-check",
    ["bun", "run", "playground:check"],
    "expected deferred: real DTO and module export unavailable"
  ],
  [
    "fixture-lint",
    [
      "node_modules/.bin/oxlint",
      "--deny-warnings",
      "packages/playground-contracts/src/SyntheticCryptoFixture.ts",
      "packages/playground-contracts/tests/SyntheticCryptoFixture.test.ts"
    ],
    "full configured lint for fixture"
  ],
  [
    "scoped-lint",
    [
      "node_modules/.bin/oxlint",
      "--deny-warnings",
      "--tsconfig",
      "apps/website/tests/ui/payload/tsconfig.json",
      ...owned.filter((path) => !path.endsWith("json"))
    ],
    "full configured scoped lint; unresolved fixture export remains deferred"
  ],
  [
    "playground-lint",
    ["bun", "run", "playground:lint"],
    "aggregate inherited failures plus unavailable new registration"
  ],
  [
    "scoped-format",
    ["node_modules/.bin/oxfmt", "--config", ".oxfmtrc.json", "--check", ...owned],
    "all owned files"
  ],
  ["diff-check", ["git", "diff", "--check"], "working diff"],
  [
    "browser",
    ["bun", "apps/website/tests/ui/payload/Browser.mjs"],
    "isolated compiled real component; no PG/workerd/recorded fixture seed"
  ]
]
const results = commands.map(([name, command, scope]) => run(name, command, scope))
for (const [path, before] of Object.entries(inputs)) {
  if (hash(path) !== before) {
    throw new Error(`Input changed during qualification: ${path}`)
  }
}
const receipt = {
  result: results.every(({ exit }) => exit === 0)
    ? "PASS"
    : "PARTIAL_WITH_EXPLICIT_DEFERRED_GATES",
  inputs,
  results,
  node: process.version,
  bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
  base: "46ad75d8297838703bd49b95eb4370e97080603d",
  versions: {
    effect: "4.0.5",
    typescript: "7.0.2",
    oxfmt: "0.71.0",
    oxlint: "1.86.0",
    react: "19.3.0",
    stylex: "0.19.1",
    baseUI: "1.9.0"
  },
  limits:
    "No push/PR/preview/DB/container operations. Actual expiry integration, stored fixture seed and shared DTO/export gates belong to serial integration. No full CI PASS."
}
writeFileSync(
  resolve(output, "qualification.json"),
  JSON.stringify(receipt, null, 2) + "\n"
)
const required = [
  "fixture-tests",
  "playground-tests",
  "isolated-types",
  "fixture-build",
  "playground-build",
  "fixture-lint",
  "scoped-format",
  "diff-check",
  "browser"
]
if (results.some(({ name, exit }) => required.includes(name) && exit !== 0)) {
  process.exitCode = 1
}
