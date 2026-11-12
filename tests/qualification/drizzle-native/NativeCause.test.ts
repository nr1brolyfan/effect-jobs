// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "vitest"
import { Cause, Data, Effect, Exit, Stream } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Native from "../../../src/postgresql/PostgreSqlNative.js"
import { PostgreSqlFailure } from "../../../src/postgresql/PostgreSqlTransaction.js"

class DomainFailure extends Data.TaggedError("DomainFailure")<{}> {}

const fixture = (failedControl: "ROLLBACK" | "COMMIT") =>
  Effect.gen(function* () {
    const statements: string[] = []
    const execute: Connection["execute"] = (text) =>
      Effect.suspend(() => {
        statements.push(text)
        return text === failedControl
          ? Effect.fail(
              new SqlError({ reason: new ConnectionError({ cause: "private-control" }) })
            )
          : Effect.succeed([])
      })
    const connection: Connection = {
      execute,
      executeUnprepared: execute,
      executeRaw: (text, values) => execute(text, values, undefined),
      executeStream: () => Stream.empty,
      executeValues: () => Effect.die("Unexpected values query"),
      executeValuesUnprepared: () => Effect.die("Unexpected values query")
    }
    const client = yield* SqlClient.make({
      driver: "test",
      acquirer: Effect.succeed(connection),
      compiler: PgClient.makeCompiler(),
      spanAttributes: []
    }).pipe(Effect.provide(Reactivity.layer))
    return { adapter: Native.make({ client, operationTimeoutMillis: 1000 }), statements }
  })

describe("owned native transaction Cause preservation", () => {
  it.each(["joined", "standalone"] as const)(
    "retains original mixed reasons and uncertain rollback on %s",
    async (mode) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* fixture("ROLLBACK")
          const error = new DomainFailure()
          const defect = new Error("private-body")
          const original = Cause.combine(Cause.fail(error), Cause.die(defect))
          let calls = 0
          const body = () =>
            Effect.suspend(() => {
              calls++
              return Effect.failCause(original)
            })
          const result = yield* Effect.exit(
            mode === "joined"
              ? db.adapter.withTransaction(body)
              : db.adapter.ownedTransaction(body)
          )
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            expect(result.cause.reasons.slice(0, 2)).toEqual(original.reasons)
            expect(result.cause.reasons.slice(2)).toEqual([
              expect.objectContaining({
                _tag: "Fail",
                error: new PostgreSqlFailure({ commitKnowledge: "Unknown" })
              })
            ])
          }
          expect(calls).toBe(1)
          expect(db.statements).toEqual(["BEGIN", "ROLLBACK"])
        })
      )
    }
  )

  it("keeps a failed COMMIT unknown without replay or inferred rollback", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture("COMMIT")
        let calls = 0
        const result = yield* Effect.exit(
          db.adapter.ownedTransaction(() =>
            Effect.sync(() => {
              calls++
              return "written"
            })
          )
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons).toEqual([
            expect.objectContaining({
              _tag: "Fail",
              error: new PostgreSqlFailure({ commitKnowledge: "Unknown" })
            })
          ])
        }
        expect(calls).toBe(1)
        expect(db.statements).toEqual(["BEGIN", "COMMIT"])
      })
    )
  })
})
