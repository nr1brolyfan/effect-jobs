import assert from "node:assert/strict"
import { Cause, Effect, Exit, Redacted } from "effect"
import { openInvocation } from "../src/Invocation.js"
const settings = {
  databaseUrl: Redacted.make(process.env.EXAMPLE_TEST_DATABASE_URL!),
  providerUrl: "https://unused.invalid"
}
for (const mode of ["success", "failure", "defect", "interruption"] as const) {
  const result = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        yield* openInvocation(settings)
        if (mode === "failure") {
          return yield* Effect.fail("synthetic")
        }
        if (mode === "defect") {
          return yield* Effect.die("synthetic")
        }
        if (mode === "interruption") {
          return yield* Effect.interrupt
        }
      })
    )
  )
  assert.equal(Exit.isSuccess(result), mode === "success")
  if (mode === "interruption" && Exit.isFailure(result)) {
    assert(Cause.hasInterrupts(result.cause))
  }
}
console.log(
  "invocation open/readiness and SQL Scope close on all four exit channels PASS"
)
