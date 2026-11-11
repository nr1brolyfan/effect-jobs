import assert from "node:assert/strict"
import { test } from "vitest"
import { runQualification } from "./Runner.js"

test("DateTime: canonical extraction, DST/ISO, keyboard/touch, focus, CSP and geometry", async () => {
  const result = await runQualification(
    "DateTime",
    "apps/website/tests/ui/DateTime.browser.ts"
  )
  assert.equal(result.exitCode, 0, result.stderr)
})
