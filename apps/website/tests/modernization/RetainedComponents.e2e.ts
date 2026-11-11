import assert from "node:assert/strict"
import { test } from "vitest"
import { runQualification } from "./Runner.js"

for (const entry of ["details/Focus.browser", "payload/Browser", "repair/Browser"]) {
  test(`${entry}: complete lifecycle, security and negative controls on canonical Vite fixtures`, async () => {
    const result = await runQualification(
      entry.replaceAll("/", "-"),
      `apps/website/tests/ui/${entry}.ts`
    )
    assert.equal(result.exitCode, 0, result.stderr)
  })
}
