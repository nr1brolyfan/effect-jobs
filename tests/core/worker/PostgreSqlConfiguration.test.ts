/** Constructor-only adapter doubles; no database or transaction qualification. */
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import * as Jobs from "../../../src/postgresql/PostgreSqlJobs.js"
import { PostgreSqlApplication } from "../../../src/postgresql/PostgreSqlTransaction.js"
import type { ApplicationAdapter } from "../../../src/postgresql/PostgreSqlTransaction.js"

const fixture = () => {
  const calls = { constructed: 0, executed: 0 }
  const unexpected = () => {
    calls.constructed++
    return Effect.suspend(() => {
      calls.executed++
      return Effect.die("Constructor must not execute the application adapter")
    })
  }
  const adapter: ApplicationAdapter = {
    validate: unexpected,
    withTransaction: unexpected,
    ownedTransaction: unexpected
  }
  return { adapter, calls }
}

const paths = ["make", "layerNoDeps"] as const
const construct = (path: (typeof paths)[number], budget: number) => {
  const options = { operationResponseBudgetMillis: budget }
  return path === "make"
    ? Jobs.make(options)
    : Jobs.PostgreSqlJobs.pipe(Effect.provide(Jobs.layerNoDeps(options)))
}

describe.each(paths)("PostgreSQL %s configuration", (path) => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects budget %s as a recoverable typed failure before adapter construction",
    async (budget) => {
      const test = fixture()
      const program = construct(path, budget).pipe(
        Effect.provideService(PostgreSqlApplication, test.adapter)
      )
      const exit = await Effect.runPromiseExit(program)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1)
        expect(exit.cause.reasons[0]).toMatchObject({
          _tag: "Fail",
          error: {
            _tag: "PostgreSqlConfigurationError",
            field: "operationResponseBudgetMillis"
          }
        })
      }
      const recovered = await Effect.runPromise(
        program.pipe(
          Effect.as("unexpected success"),
          Effect.catchTags({
            PostgreSqlConfigurationError: (error) => Effect.succeed(error.field)
          })
        )
      )
      expect(recovered).toBe("operationResponseBudgetMillis")
      expect(test.calls).toEqual({ constructed: 0, executed: 0 })
    }
  )

  it("accepts a valid budget without executing the readiness adapter", async () => {
    const test = fixture()
    const jobs = await Effect.runPromise(
      construct(path, 100).pipe(
        Effect.provideService(PostgreSqlApplication, test.adapter)
      )
    )
    expect(jobs.operationResponseBudgetMillis).toBe(100)
    expect(jobs.storage.operationResponseBudgetMillis).toBe(100)
    expect(test.calls).toEqual({ constructed: 1, executed: 0 })
  })
})
