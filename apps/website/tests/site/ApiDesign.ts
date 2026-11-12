// This website snapshot predates the contract-first library. For snippet checks:
// API_DESIGN_SOURCE_ROOT=/path/to/current/effect-jobs node apps/website/tests/site/ApiDesign.ts
// No provider calls or database mutations are executed.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { publicModules } from "../../../../scripts/SourceExports.mjs"

const root = resolve(import.meta.dirname, "../../../..")
const sourceRoot = resolve(process.env.API_DESIGN_SOURCE_ROOT ?? root)
const pagePath = join(
  root,
  "apps/website/src/content/docs/concepts/api-design-decisions.mdx"
)
const page = readFileSync(pagePath, "utf8")
const snippets = [...page.matchAll(/```ts\n([\s\S]*?)\n```/g)].map((match) => match[1]!)
assert.equal(snippets.length, 7, "All displayed TypeScript fragments must be checked")
const assertYieldFormatting = (source: string) => {
  assert.doesNotMatch(source, /\byield\s+\*/, "Keep yield* together")
  assert.doesNotMatch(
    source,
    /\byield\*[\t ]*\r?\n/,
    "Keep the delegated expression on the same line"
  )
}
for (const snippet of snippets) {
  assertYieldFormatting(snippet)
}
const formatted = execFileSync(
  join(root, "node_modules/.bin/oxfmt"),
  ["--config", join(root, ".oxfmtrc.json"), "--stdin-filepath", pagePath],
  { cwd: root, input: page, encoding: "utf8" }
)
assert.deepEqual(
  [...formatted.matchAll(/```ts\n([\s\S]*?)\n```/g)].map((match) => match[1]!),
  snippets,
  "The repository formatter must preserve displayed TypeScript fragments"
)
for (const broken of ["yield * send", "yield*\n  send", "yield *\n  send"]) {
  assert.throws(() => assertYieldFormatting(broken), /Keep/)
}
assert.ok(!page.includes("Fragments below omit imports"), "No redundant setup disclaimer")
assert.ok(!page.includes("<JobVisual"), "Do not repeat the tutorial transaction visual")

const imports = `
import { Duration, Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Producer from "effect-jobs/JobProducer"
import * as Queue from "effect-jobs/JobQueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import type { Backend } from "effect-jobs/PostgreSqlJobs"
const Codes = FailureCode.define({
  ProviderBusy: "provider_busy",
  InvalidRecipient: "invalid_recipient",
  InvalidCredentials: "invalid_credentials",
  ResponseLost: "response_lost"
})
`
const application = `
declare const jobs: Backend
declare const saveOrder: Effect.Effect<void>
declare const send: Effect.Effect<void,
  { readonly _tag: "ProviderBusy" } | { readonly _tag: "InvalidRecipient" } |
  { readonly _tag: "InvalidCredentials" } | { readonly _tag: "ResponseLost" }
>
`
const directory = mkdtempSync("/tmp/opencode/jobs-api-design-")
try {
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n')
  const program = `${imports}\n${application}\nEffect.gen(function* () {\n${snippets.join("\n\n")}\n
    // Queues are fixed; definitions without defaults require a complete policy.
    // @ts-expect-error Fixed routing forbids any queue property.
    yield* PlaceOrder.enqueue("confirmation", { ...request, queue: MailQueue.name })
    // @ts-expect-error This definition has no default policy.
    yield* RoutedOrder.enqueue("confirmation", request)
    // @ts-expect-error An undeclared slot cannot borrow a valid payload.
    yield* PlaceOrder.enqueue("missing", request)
  })\n`
  writeFileSync(join(directory, "Snippets.ts"), program)
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "ESNext.Disposable"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        noEmit: true,
        types: ["node"],
        typeRoots: [join(sourceRoot, "node_modules/@types")],
        paths: {
          ...Object.fromEntries(
            publicModules(
              JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"))
            ).map((module) => [
              module.subpath === "." ? "effect-jobs" : `effect-jobs/${module.name}`,
              [join(sourceRoot, module.source)]
            ])
          ),
          effect: [join(sourceRoot, "node_modules/effect/dist/index.d.ts")],
          "effect/*": [join(sourceRoot, "node_modules/effect/dist/*")]
        }
      },
      files: ["Snippets.ts"]
    })
  )
  execFileSync(
    process.execPath,
    [
      join(sourceRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      join(directory, "tsconfig.json")
    ],
    { stdio: "inherit" }
  )
  console.log(
    "PASS: all seven displayed fragments and three negative queue/policy/slot controls typecheck"
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}

const built = readFileSync(
  join(root, "apps/website/dist/site/docs/concepts/api-design-decisions/index.html"),
  "utf8"
)
assert.match(built, /<title>API design decisions/)
assert.doesNotMatch(built, /data-job-visual=/)
assert.doesNotMatch(built, /Immutable assembly|How this differs from other queues/)
assert.match(built, /aria-current="page"[^>]*>API design decisions/)
for (const tag of ["Retry", "Dead", "Isolate", "OutcomeUnknown"]) {
  assert.ok(built.includes(tag), `Built page must explain ${tag}`)
}
assert.ok(!/```/.test(built), "No raw Markdown fences in rendered output")
console.log(
  "PASS: built route, active sidebar entry, failure outcomes and compact content"
)
