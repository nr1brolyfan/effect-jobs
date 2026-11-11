import assert from "node:assert/strict"
import { test } from "vitest"
import { runQualification } from "./Runner.js"

for (const entry of [
  "DashboardRefresh",
  "Declutter.browser",
  "DetailsIntegration",
  "OperatorReappearance.browser",
  "Production",
  "ShellPayload",
  "StatsChart.browser",
  "Ux"
]) {
  test(`${entry}: retain full production-browser behavior and negative controls`, async () => {
    const result = await runQualification(
      entry.replaceAll("/", "-"),
      `apps/website/tests/ui/${entry}.ts`
    )
    assert.equal(result.exitCode, 0, result.stderr)
  })
}
