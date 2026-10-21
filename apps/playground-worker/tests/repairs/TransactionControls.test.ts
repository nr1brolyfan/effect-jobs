// @effect-diagnostics unstableApiUsage:off
// Exercise the same pinned SQL error API as the existing authority fixtures.
import { expect, it } from "vitest"
import { Cause, Effect, Exit } from "effect"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import { controls } from "../../src/persistence/authority/TransactionControls.js"
import { CommandTransactionFailure } from "../../src/persistence/commands/Transactions.js"

it("preserves successful transaction results", async () => {
  expect(await Effect.runPromise(controls(Effect.succeed("committed")))).toBe("committed")
})

it.each(["fail", "die"] as const)(
  "maps SQL %s to unknown commit knowledge",
  async (kind) => {
    const error = new SqlError({
      reason: new ConnectionError({ cause: "lost response" })
    })
    const operation = kind === "fail" ? Effect.fail(error) : Effect.die(error)
    const exit = await Effect.runPromiseExit(controls(operation))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1)
      const reason = exit.cause.reasons[0]!
      expect(Cause.isFailReason(reason)).toBe(true)
      if (Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(CommandTransactionFailure)
        if (reason.error instanceof CommandTransactionFailure) {
          expect(reason.error.commitKnowledge).toBe("Unknown")
        }
      }
    }
  }
)

it("preserves non-SQL failure, defect and interruption in a mixed Cause", async () => {
  const error = new SqlError({ reason: new ConnectionError({ cause: "lost response" }) })
  const domain = new Error("domain failure")
  const defect = new Error("non-SQL defect")
  const original = Cause.fromReasons([
    Cause.makeFailReason(error),
    Cause.makeFailReason(domain),
    Cause.makeDieReason(error),
    Cause.makeDieReason(defect),
    ...Cause.interrupt().reasons
  ])
  const exit = await Effect.runPromiseExit(controls(Effect.failCause(original)))
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toHaveLength(original.reasons.length)
    for (const index of [0, 2]) {
      const reason = exit.cause.reasons[index]!
      expect(Cause.isFailReason(reason)).toBe(true)
      if (Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(CommandTransactionFailure)
      }
    }
    for (const index of [1, 3, 4]) {
      expect(exit.cause.reasons[index]).toBe(original.reasons[index])
    }
  }
})
