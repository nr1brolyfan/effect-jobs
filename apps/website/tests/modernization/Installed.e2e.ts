import assert from "node:assert/strict"
import { test } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { runQualification } from "./Runner.js"

test("fresh packed Bun graph preserves exact-six foreign strict FAIL and independently qualifies own callers", async () => {
  const directory = await mkdtemp(resolve(".multica/packed-contract-"))
  try {
    const receiptPath = resolve(directory, "receipt.json")
    const result = await runQualification(
      "vitest-installed",
      "apps/website/tests/ui/Packed.ts",
      { ...process.env, UI_PACKED_RECEIPT: receiptPath }
    )
    assert.equal(result.exitCode, 1)
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      readonly result: string
      readonly acceptedForeignDiagnosticContract: string
      readonly tools: { readonly effect: string; readonly atomReact: string }
      readonly resolution: {
        readonly canonicalJobsManifest: string
        readonly contractsJobsManifest: string
      }
      readonly foreignStrictDiagnostics: ReadonlyArray<{
        readonly path: string
        readonly code: string
      }>
      readonly commandResults: ReadonlyArray<{
        readonly name: string
        readonly exitCode: number
      }>
    }
    assert.equal(receipt.result, "FAIL")
    assert.equal(receipt.acceptedForeignDiagnosticContract, "exact-six FAIL")
    assert.equal(receipt.tools.effect, "4.1.0")
    assert.equal(receipt.tools.atomReact, "4.1.0")
    assert.equal(
      receipt.resolution.contractsJobsManifest,
      receipt.resolution.canonicalJobsManifest
    )
    assert.equal(receipt.foreignStrictDiagnostics.length, 6)
    assert(
      receipt.foreignStrictDiagnostics.every(
        (diagnostic) =>
          diagnostic.path === "node_modules/@reduxjs/toolkit/dist/index.d.ts"
      )
    )
    for (const name of [
      "install",
      "own-types",
      "browser",
      "smoke-types",
      "node-smoke",
      "bun-smoke"
    ]) {
      assert.equal(
        receipt.commandResults.find((command) => command.name === name)?.exitCode,
        0,
        name
      )
    }
    assert.equal(
      receipt.commandResults.find((command) => command.name === "negative-types")
        ?.exitCode,
      1
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
