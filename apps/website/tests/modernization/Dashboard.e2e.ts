import assert from "node:assert/strict"
import { test } from "vitest"
import { runQualification } from "./Runner.js"

for (const name of ["Browser", "Reconciliation", "Primitives"]) {
  test(`${name}: retain the complete browser oracle through canonical Vite/StyleX`, async () => {
    const result = await runQualification(
      `vitest-${name}`,
      `apps/website/tests/ui/${name}.ts`
    )
    assert.equal(result.exitCode, 0, result.stderr)
  })
}
