import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))

const probe = (source: string, tool: "tsc" | "oxlint") => {
  const temporaryRoot = join(root, ".toolchain")
  mkdirSync(temporaryRoot, { recursive: true })
  const directory = mkdtempSync(join(temporaryRoot, "probe-"))
  try {
    const file = join(directory, "probe.ts")
    const project = join(directory, "tsconfig.json")
    writeFileSync(file, source)
    writeFileSync(
      project,
      JSON.stringify({
        extends: "../../tsconfig.json",
        files: ["probe.ts"],
        include: []
      })
    )
    const args =
      tool === "tsc"
        ? ["--project", project, "--noEmit", "--pretty", "false"]
        : [
            "--config",
            join(root, ".oxlintrc.json"),
            "--tsconfig",
            project,
            "--deny-warnings",
            "--no-ignore",
            file
          ]
    const result = spawnSync(join(root, "node_modules", ".bin", tool), args, {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it("accepts a properly yielded Effect with the patched compiler", () => {
  const result = probe(
    'import { Effect } from "effect"\nexport const program = Effect.gen(function* () { return yield* Effect.succeed(1) })\n',
    "tsc"
  )
  expect(result.status, result.output).toBe(0)
}, 30_000)

it("rejects a floating Effect through the patched compiler", () => {
  const result = probe('import { Effect } from "effect"\nEffect.succeed(1)\n', "tsc")
  expect(result.status).not.toBe(0)
  expect(result.output).toMatch(/floatingEffect|floating.effect|not yielded/i)
}, 30_000)

it("preserves ordinary TypeScript type checking", () => {
  const result = probe("export const value: string = 1\n", "tsc")
  expect(result.status).not.toBe(0)
  expect(result.output).toContain("TS2322")
}, 30_000)

it("rejects a floating Effect through type-aware Oxlint", () => {
  const result = probe('import { Effect } from "effect"\nEffect.succeed(1)\n', "oxlint")
  expect(result.status).not.toBe(0)
  expect(result.output).toContain("effecttsgo(floating-effect)")
}, 30_000)

it("accepts a properly yielded Effect through type-aware Oxlint", () => {
  const result = probe(
    'import { Effect } from "effect"\nexport const program = Effect.gen(function* () { return yield* Effect.succeed(1) })\n',
    "oxlint"
  )
  expect(result.status, result.output).toBe(0)
}, 30_000)

it("rejects explicit any through Oxlint", () => {
  const result = probe("export const identity = (value: any) => value\n", "oxlint")
  expect(result.status).not.toBe(0)
  expect(result.output).toContain("no-explicit-any")
}, 30_000)
