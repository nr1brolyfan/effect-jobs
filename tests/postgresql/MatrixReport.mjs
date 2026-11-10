import assert from "node:assert/strict"

export const assertComplete = (result, root) => {
  assert.equal(result.success, true)
  const expected = [
    "tests/postgresql/Backend.test.ts",
    "tests/postgresql/Schema.test.ts",
    "tests/postgresql/operators/Operators.test.ts",
    "tests/qualification/d6-pg/qualification.test.ts"
  ]
  assert.deepEqual(
    result.testResults.map((file) => file.name.slice(root.length)).sort(),
    expected.sort()
  )
  for (const file of result.testResults) {
    assert(file.assertionResults.length > 0, `Empty suite: ${file.name}`)
    assert.equal(file.status, "passed")
    for (const test of file.assertionResults) {
      assert.equal(test.status, "passed", `Non-passing test: ${test.fullName}`)
    }
  }
}
