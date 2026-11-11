import assert from "node:assert/strict"
import { test } from "vitest"
import { runQualification } from "./Runner.js"

for (const entry of [
  "AcknowledgementFocus",
  "repair/Applicability.browser",
  "repair/Composition"
]) {
  test(`${entry}: focus, command applicability, exact receipts and no replay`, async () => {
    const result = await runQualification(
      entry.replaceAll("/", "-"),
      `apps/website/tests/ui/${entry}.ts`
    )
    assert.equal(result.exitCode, 0, result.stderr)
  })
}
