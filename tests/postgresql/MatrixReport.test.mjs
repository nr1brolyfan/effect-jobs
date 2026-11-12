import { expect, test } from "vitest"
import { assertComplete } from "./MatrixReport.mjs"

const report = () => ({
  success: true,
  testResults: [
    "tests/postgresql/Jobs.test.ts",
    "tests/postgresql/CreationTime.test.ts",
    "tests/postgresql/Observability.test.ts",
    "tests/postgresql/Schema.test.ts",
    "tests/postgresql/operators/Operators.test.ts",
    "tests/qualification/d6-pg/qualification.test.ts"
  ].map((name) => ({
    name: `/repo/${name}`,
    status: "passed",
    assertionResults: [{ status: "passed" }]
  }))
})

test("matrix accepts only complete successful reports", () => {
  expect(() => assertComplete(report(), "/repo/")).not.toThrow()
  for (const status of ["pending", "skipped", "todo", "failed"]) {
    const result = report()
    result.testResults[0].assertionResults[0].status = status
    expect(() => assertComplete(result, "/repo/")).toThrow()
  }
  const missing = report()
  missing.testResults.pop()
  expect(() => assertComplete(missing, "/repo/")).toThrow()
  const empty = report()
  empty.testResults[0].assertionResults = []
  expect(() => assertComplete(empty, "/repo/")).toThrow()
  const failed = report()
  failed.success = false
  expect(() => assertComplete(failed, "/repo/")).toThrow()
})
