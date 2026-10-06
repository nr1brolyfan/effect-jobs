import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { releaseImports } from "../../scripts/release-imports.mjs"

const root = resolve(import.meta.dirname, "../..")

test("archive graph ignores comments and literal prose, and parses import syntax", () => {
  const result = releaseImports([
    {
      filename: "Job.js",
      source: `
/** @example import * as Job from "effect-jobs/Job" */
// import "comment-only"
const prose = 'from "string-only"'
const template = \`import("template-only")\`
const regex = /import[(]"regex-only"[)]/
import /* gap */ { Effect } from /* gap */ "effect"
import "node:fs"
export * from "drizzle-orm/pg-core"
const dynamic = import(/* gap */ "actual-dynamic")
const escaped = import("\\u0065scaped")
const nested = \`text \${import("nested-dynamic")}\`
const templateImport = import(\`template-dynamic\`)
`
    },
    {
      filename: "Job.d.ts",
      source: `
/** @import { Job } from "comment-only" */
import type { Effect } from "effect"
export type Job = import(/* gap */ "actual-type").Job
import Alias = require("actual-require")
export { Job as Other } from "actual-export"
`
    }
  ])
  assert.deepEqual(
    result.map(({ imports }) => imports),
    [
      [
        "effect",
        "node:fs",
        "drizzle-orm/pg-core",
        "actual-dynamic",
        "escaped",
        "nested-dynamic",
        "template-dynamic"
      ],
      ["effect", "actual-type", "actual-require", "actual-export"]
    ]
  )
})

test("release guard still rejects actual disallowed imports", () => {
  const scratch = join(root, ".toolchain")
  mkdirSync(scratch, { recursive: true })
  const directory = mkdtempSync(join(scratch, "release-import-regression-"))
  try {
    const packageDirectory = join(directory, "package")
    mkdirSync(join(packageDirectory, "dist"), { recursive: true })
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    writeFileSync(join(packageDirectory, "package.json"), JSON.stringify(manifest))
    for (const target of Object.values(manifest.exports)) {
      for (const filename of Object.values(target)) {
        writeFileSync(join(packageDirectory, filename), "export {}\n")
      }
    }
    const archive = join(directory, "fixture.tgz")
    for (const source of [
      'import "effect-jobs/Job"',
      'export * from "not-allowed"',
      'const dynamic = import(/* gap */ "not-allowed")',
      'export type T = import("not-allowed").T'
    ]) {
      const filename = source.includes("type T") ? "Job.d.ts" : "Job.js"
      writeFileSync(join(packageDirectory, "dist", filename), source)
      execFileSync(
        "tar",
        [
          "-czf",
          archive,
          "-C",
          directory,
          "package/package.json",
          ...Object.values(manifest.exports).flatMap((target) =>
            Object.values(target).map((path) => `package/${path.slice(2)}`)
          )
        ],
        { timeout: 60000 }
      )
      const result = spawnSync("node", ["scripts/check-release.mjs"], {
        cwd: root,
        env: { ...process.env, EFFECT_JOBS_ARCHIVE: archive },
        encoding: "utf8",
        timeout: 60000
      })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Unexpected dependency (effect-jobs\/Job|not-allowed)/)
      writeFileSync(join(packageDirectory, "dist", filename), "export {}\n")
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
