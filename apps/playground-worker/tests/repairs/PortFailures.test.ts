// @effect-diagnostics unstableApiUsage:off
import { expect, it } from "vitest"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Authority from "../../src/persistence/authority/PostgreSqlAuthority.js"
import * as Mode from "../../src/persistence/authority/PrivateMode.js"
import * as Repairs from "../../src/persistence/authority/PostgreSqlRepairTransactions.js"
import { CommandTransactionFailure } from "../../src/persistence/commands/Transactions.js"
import type { StoredReceipt } from "../../src/persistence/commands/Transactions.js"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { keysLayer } from "../../src/scenarios/PrivateDocument.js"
import * as Plan from "../../src/scenarios/Plan.js"
import * as Fixture from "./Fixtures.js"

// Real Effect SQL statement/transaction machinery, finite recording driver.
// This checks adapter failure/control behavior, not PostgreSQL locking or durability.
const fixture = Effect.gen(function* () {
  const statements: string[] = []
  let armed = false
  const execute: Connection["execute"] = (text) =>
    Effect.suspend(
      (): Effect.Effect<ReadonlyArray<Record<string, unknown>>, SqlError> => {
        statements.push(text)
        if (armed && text !== "COMMIT" && text !== "ROLLBACK") {
          return Effect.fail(
            new SqlError({ reason: new ConnectionError({ cause: "private-sql-detail" }) })
          )
        }
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) {
          return Effect.succeed([])
        }
        if (text.includes("SELECT * FROM")) {
          return Effect.succeed([
            {
              sandbox_id: Fixture.ref.sandboxId,
              generation: 1,
              expires_at: 100000,
              retained_jobs: 0,
              demo_owned: false
            }
          ])
        }
        if (text.includes("clock_timestamp()")) {
          return Effect.succeed([{ now: 900, db_now: 900 }])
        }
        if (text.includes("count(*)")) {
          return Effect.succeed([{ n: 0 }])
        }
        if (text.includes("INSERT INTO") && text.includes("command_admission")) {
          return Effect.succeed([{ request_id: "port-test" }])
        }
        if (text.includes("admission") || text.includes("repair_receipts")) {
          return Effect.succeed([])
        }
        if (text.includes("INSERT INTO")) {
          return Effect.succeed([])
        }
        return Effect.die(new Error(`Unexpected statement: ${text}`))
      }
    )
  const connection: Connection = {
    execute,
    executeUnprepared: execute,
    executeRaw: (text, params) => execute(text, params, undefined),
    executeStream: () => Stream.die("Unexpected stream"),
    executeValues: () => Effect.die("Unexpected values"),
    executeValuesUnprepared: () => Effect.die("Unexpected values")
  }
  const client = yield* SqlClient.make({
    acquirer: Effect.succeed(connection),
    compiler: PgClient.makeCompiler(),
    spanAttributes: []
  }).pipe(Effect.provide(Reactivity.layer))
  const commands = yield* Authority.make("port_test").pipe(
    Effect.provideService(SqlClient.SqlClient, client),
    Effect.provide(keysLayer),
    Effect.provide(
      Layer.mock(JobEnqueue, {
        enqueue: () => Effect.die("Unexpected enqueue"),
        enqueueStandalone: () => Effect.die("Unexpected standalone enqueue")
      })
    )
  )
  const repairs = yield* Repairs.make("port_test").pipe(
    Effect.provideService(SqlClient.SqlClient, client),
    Effect.provideService(Mode.LocalPrivate, true)
  )
  return {
    commands: commands.transactions,
    repairs,
    statements,
    arm: () => {
      armed = true
    }
  }
})

const access = {
  sandbox: {
    ref: Fixture.ref,
    expiresAt: 100000,
    capabilities: {
      runScenario: true,
      resetSandbox: true,
      retryJob: true,
      cancelJob: true,
      redriveJob: true
    }
  }
}
const request = { sandbox: Fixture.ref, requestId: "port-test" }
const scenario = { ...request, scenario: "success" as const, count: 1 }
const receipt: StoredReceipt = {
  _tag: "Scenario",
  command: scenario,
  result: {
    _tag: "Committed",
    ...request,
    jobIds: [Fixture.sourceId]
  }
}

it.each(["now", "associate", "saveReceipt", "audit"] as const)(
  "%s preserves success and maps SQL failure to Unknown without committing the body",
  async (port) => {
    for (const fail of [false, true]) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* fixture
          const planned = (yield* Plan.plan(scenario, Fixture.ref, 0))[0]!
          const arm = Effect.sync(() => {
            if (fail) {
              db.arm()
            }
          })
          const operation =
            port === "now"
              ? db.repairs.owned(access, Fixture.command, "a".repeat(64), (tx) =>
                  arm.pipe(Effect.andThen(tx.now), Effect.asVoid)
                )
              : db.commands.owned(access, request, "Scenario", (tx) =>
                  arm.pipe(
                    Effect.andThen(
                      port === "associate"
                        ? tx.associate(Fixture.sourceId, planned)
                        : port === "saveReceipt"
                          ? tx.saveReceipt(receipt)
                          : tx.audit({
                              operation: "Scenario",
                              reason: "synthetic-scenario",
                              count: 1
                            })
                    )
                  )
                )
          const exit = yield* Effect.exit(operation)
          expect(
            Exit.isFailure(exit),
            JSON.stringify({ exit, statements: db.statements })
          ).toBe(fail)
          expect(db.statements.filter((s) => s === "COMMIT")).toHaveLength(fail ? 1 : 2)
          expect(db.statements.filter((s) => s === "ROLLBACK")).toHaveLength(fail ? 1 : 0)
          if (Exit.isFailure(exit)) {
            expect(exit.cause.reasons).toHaveLength(1)
            const reason = exit.cause.reasons[0]!
            expect(Cause.isFailReason(reason)).toBe(true)
            if (Cause.isFailReason(reason)) {
              expect(reason.error).toBeInstanceOf(CommandTransactionFailure)
              expect(reason.error).toMatchObject({ commitKnowledge: "Unknown" })
              expect(JSON.stringify(reason.error)).not.toContain("private-sql-detail")
            }
          }
        })
      )
    }
  }
)
