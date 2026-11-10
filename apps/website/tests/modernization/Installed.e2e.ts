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
      readonly commandResults: ReadonlyArray<{
        readonly name: string
        readonly exitCode: number
      }>
    }
    assert.equal(receipt.result, "FAIL")
    assert.equal(receipt.acceptedForeignDiagnosticContract, "exact-six FAIL")
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
