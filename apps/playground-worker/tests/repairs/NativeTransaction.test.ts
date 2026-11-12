// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Stream } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as NativeTransaction from "../../src/persistence/NativeTransaction.js"

const fixture = (failControl: "COMMIT" | "ROLLBACK" | undefined) =>
  Effect.gen(function* () {
    const statements: string[] = []
    const controlError = new SqlError({
      reason: new ConnectionError({ cause: "synthetic-control-failure" })
    })
    const execute: Connection["execute"] = (text) =>
      Effect.suspend(() => {
        statements.push(text)
        return text === failControl ? Effect.fail(controlError) : Effect.succeed([])
      })
    const connection: Connection = {
      execute,
      executeUnprepared: execute,
      executeRaw: (text, params) => execute(text, params, undefined),
      executeStream: () => Stream.die("Unexpected stream"),
      executeValues: () => Effect.die("Unexpected values"),
      executeValuesUnprepared: () => Effect.die("Unexpected values")
    }
    const sql = yield* SqlClient.make({
      driver: "test",
      acquirer: Effect.succeed(connection),
      compiler: PgClient.makeCompiler(),
      spanAttributes: []
    }).pipe(Effect.provide(Reactivity.layer))
    return { sql, statements, controlError }
  })

describe("application native transaction cause preservation", () => {
  it("retains exact body reasons plus native rollback defects without replay", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture("ROLLBACK")
        const bodyError = { code: "synthetic-domain" }
        const bodyDefect = new Error("synthetic-defect")
        const original = Cause.combine(Cause.fail(bodyError), Cause.die(bodyDefect))
        let runs = 0
        const result = yield* Effect.exit(
          NativeTransaction.withTransaction(
            db.sql,
            Effect.suspend(() => {
              runs++
              return Effect.failCause(original)
            })
          )
        )
        expect(runs).toBe(1)
        expect(db.statements).toEqual(["BEGIN", "ROLLBACK"])
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons.slice(0, 2)).toEqual(original.reasons)
          expect(result.cause.reasons[0]).toBe(original.reasons[0])
          expect(result.cause.reasons[1]).toBe(original.reasons[1])
          const cleanup = result.cause.reasons[2]!
          expect(Cause.isDieReason(cleanup) && cleanup.defect).toBe(db.controlError)
        }
      })
    )
  })

  it("retains interruption while preserving failed rollback diagnostics", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const db = yield* fixture("ROLLBACK")
        const original = Cause.combine(Cause.fail("domain"), Cause.interrupt(41))
        const result = yield* Effect.exit(
          NativeTransaction.withTransaction(db.sql, Effect.failCause(original))
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons.slice(0, 2)).toEqual(original.reasons)
          expect(result.cause.reasons[1]).toBe(original.reasons[1])
          expect(result.cause.reasons.map((reason) => reason._tag)).toEqual([
            "Fail",
            "Interrupt",
            "Die"
          ])
        }
      })
    )
    expect(Exit.isSuccess(result)).toBe(true)
  })

  it("keeps acknowledged rollback body failures typed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture(undefined)
        const original = Cause.fail("domain")
        const result = yield* Effect.exit(
          NativeTransaction.withTransaction(db.sql, Effect.failCause(original))
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons).toEqual(original.reasons)
        }
        expect(db.statements).toEqual(["BEGIN", "ROLLBACK"])
      })
    )
  })

  it("preserves a commit failure after a successful body without replay", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture("COMMIT")
        let runs = 0
        const result = yield* Effect.exit(
          NativeTransaction.withTransaction(
            db.sql,
            Effect.sync(() => ++runs)
          )
        )
        expect(runs).toBe(1)
        expect(db.statements).toEqual(["BEGIN", "COMMIT"])
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const control = result.cause.reasons[0]!
          expect(Cause.isFailReason(control) && control.error).toBe(db.controlError)
        }
      })
    )
  })
})
