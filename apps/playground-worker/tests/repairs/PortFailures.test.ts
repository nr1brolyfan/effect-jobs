import { runPromise } from "../scenarios/Setup.js"
// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "vitest"
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
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"

// Real Effect SQL statement/transaction machinery, finite recording driver.
// This checks adapter failure/control behavior, not PostgreSQL locking or durability.
const fixture = Effect.gen(function* () {
  const statements: string[] = []
  let armed = false
  const execute: Connection["execute"] = (text) =>
    Effect.suspend(
      (): Effect.Effect<ReadonlyArray<Record<string, unknown>>, SqlError> => {
        statements.push(text)
        const normalized = text.toUpperCase()
        if (armed && text !== "COMMIT" && text !== "ROLLBACK") {
          return Effect.fail(
            new SqlError({ reason: new ConnectionError({ cause: "private-sql-detail" }) })
          )
        }
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) {
          return Effect.succeed([])
        }
        if (normalized.includes("SELECT * FROM")) {
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
        if (normalized.includes("INSERT INTO") && text.includes("command_admission")) {
          return Effect.succeed([{ request_id: "port-test" }])
        }
        if (text.includes("admission") || text.includes("repair_receipts")) {
          return Effect.succeed([])
        }
        if (normalized.includes("INSERT INTO")) {
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
    driver: "test",
    acquirer: Effect.succeed(connection),
    compiler: PgClient.makeCompiler(),
    spanAttributes: []
  }).pipe(Effect.provide(Reactivity.layer))
  const pg: PgClient.PgClient = Object.assign(client, {
    [PgClient.TypeId]: PgClient.TypeId,
    config: {},
    json: () => {
      throw new Error("Unexpected JSON fragment")
    },
    listen: () => Effect.die("Unexpected LISTEN"),
    notify: () => Effect.die("Unexpected NOTIFY"),
    poolStats: Effect.die("Unexpected pool stats")
  } satisfies Pick<
    PgClient.PgClient,
    PgClient.TypeId | "config" | "json" | "listen" | "notify" | "poolStats"
  >)
  const commands = yield* Authority.make("port_test", pg).pipe(
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
      await runPromise(
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

describe("command authority compiled query bridge", () => {
  const access = { sandbox: Fixtures.sandbox }
  const request = { sandbox: Fixtures.sandbox.ref, requestId: " exact-e\u0301-request " }
  const scenario = { ...request, scenario: "success" as const, count: 1 }
  const receipt: StoredReceipt = {
    _tag: "Scenario",
    command: scenario,
    result: {
      _tag: "Committed",
      ...request,
      jobIds: [Fixtures.page.items[0]!.jobId]
    }
  }
  interface Options {
    readonly prior?: ReadonlyArray<Record<string, unknown>>
    readonly inserted?: ReadonlyArray<Record<string, unknown>>
    readonly receipts?: ReadonlyArray<Record<string, unknown>>
    readonly budget?: unknown
    readonly sandbox?: Record<string, unknown>
    readonly foreignClient?: boolean
  }
  const fixture = (options: Options = {}) =>
    Effect.gen(function* () {
      const statements: Array<{
        readonly text: string
        readonly params: readonly unknown[]
      }> = []
      const execute: Connection["execute"] = (text, params) =>
        Effect.suspend(() => {
          statements.push({ text, params })
          const normalized = text.toLowerCase()
          if (["begin", "commit", "rollback"].includes(normalized)) {
            return Effect.succeed([])
          }
          if (normalized.startsWith("select * from")) {
            return Effect.succeed([
              {
                sandbox_id: request.sandbox.sandboxId,
                generation: 1n,
                expires_at: 100000n,
                viewer_until: 0n,
                retained_jobs: 0n,
                demo_owned: false,
                ...options.sandbox
              }
            ])
          }
          if (normalized.includes("clock_timestamp()")) {
            return Effect.succeed([{ db_now: 1000n }])
          }
          if (normalized.includes("count(*)")) {
            return Effect.succeed([
              { n: options.budget === undefined ? 0n : options.budget }
            ])
          }
          if (normalized.startsWith('select "request_id"')) {
            return Effect.succeed(options.prior ?? [])
          }
          if (normalized.startsWith('select "receipt"')) {
            return Effect.succeed(options.receipts ?? [{ receipt }])
          }
          if (
            normalized.startsWith('insert into "command_authority"."command_admission"')
          ) {
            return Effect.succeed(options.inserted ?? [{ request_id: request.requestId }])
          }
          if (
            normalized.startsWith('insert into "command_authority"."associations"') ||
            normalized.startsWith('insert into "command_authority"."command_receipts"')
          ) {
            return Effect.succeed([])
          }
          return Effect.die(new Error(`Unexpected statement: ${text}`))
        })
      const connection: Connection = {
        execute,
        executeUnprepared: execute,
        executeRaw: (text, params) => execute(text, params, undefined),
        executeStream: () => Stream.die("Unexpected stream"),
        executeValues: () => Effect.die("Unexpected mapped values execution"),
        executeValuesUnprepared: () => Effect.die("Unexpected mapped values execution")
      }
      const makeClient = () =>
        SqlClient.make({
          driver: "test",
          acquirer: Effect.succeed(connection),
          compiler: PgClient.makeCompiler(),
          spanAttributes: []
        }).pipe(Effect.provide(Reactivity.layer))
      const client = yield* makeClient()
      const pg: PgClient.PgClient = Object.assign(
        options.foreignClient ? yield* makeClient() : client,
        {
          [PgClient.TypeId]: PgClient.TypeId,
          config: {},
          json: () => {
            throw new Error("Unexpected JSON fragment")
          },
          listen: () => Effect.die("Unexpected LISTEN"),
          notify: () => Effect.die("Unexpected NOTIFY"),
          poolStats: Effect.die("Unexpected pool stats")
        } satisfies Pick<
          PgClient.PgClient,
          PgClient.TypeId | "config" | "json" | "listen" | "notify" | "poolStats"
        >
      )
      const make = Authority.make("command_authority", pg).pipe(
        Effect.provideService(SqlClient.SqlClient, client),
        Effect.provide(keysLayer),
        Effect.provide(Layer.mock(JobEnqueue, {}))
      )
      return { make, client, statements }
    })

  const assertFailure = <A, E>(
    exit: Exit.Exit<A, E>,
    expected: PlaygroundError | CommandTransactionFailure
  ) => {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1)
      const reason = exit.cause.reasons[0]!
      expect(Cause.isFailReason(reason)).toBe(true)
      if (Cause.isFailReason(reason)) {
        expect(reason.error).toEqual(expected)
        expect(JSON.stringify(reason.error)).not.toContain("private-")
      }
    }
  }

  it("executes five actual CRUD sites with physical projections and ordered bound parameters", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture()
        const services = yield* db.make
        const planned = (yield* Plan.plan(scenario, request.sandbox, 0))[0]!
        const value = yield* services.transactions.owned(
          access,
          request,
          "Scenario",
          (tx) =>
            Effect.gen(function* () {
              expect(tx.admission).toBe("Fresh")
              expect(tx.current).toEqual(request.sandbox)
              expect(tx.dbNow).toBe(1000)
              expect(tx.expiresAt).toBe(100000)
              const saved = yield* tx.receipt(request, "Scenario")
              yield* tx.associate(Fixtures.page.items[0]!.jobId, planned)
              yield* tx.saveReceipt(receipt)
              return saved
            })
        )
        expect(value).toEqual(receipt)
        const compiled = db.statements.filter((statement) =>
          /^(select "|insert into)/i.test(statement.text)
        )
        expect(compiled).toHaveLength(5)
        const identity = [request.sandbox.sandboxId, 1, "Scenario", request.requestId]
        expect(compiled.map((statement) => statement.params)).toEqual([
          identity,
          identity,
          identity,
          [
            request.sandbox.sandboxId,
            1,
            Fixtures.page.items[0]!.jobId,
            JSON.stringify({
              syntheticActor: planned.payload.actor,
              syntheticTenant: planned.payload.tenant,
              syntheticOrderId: planned.payload.order
            })
          ],
          [...identity, JSON.stringify(receipt)]
        ])
        expect(compiled[0]!.text).toMatch(
          /^select "request_id" from "command_authority"\."command_admission" where /i
        )
        expect(compiled[1]!.text).toMatch(
          /^insert into "command_authority"\."command_admission" \("sandbox_id", "generation", "operation", "request_id"\) values \(\$1, \$2, \$3, \$4\) on conflict do nothing returning "request_id"$/i
        )
        expect(compiled[2]!.text).toMatch(
          /^select "receipt" from "command_authority"\."command_receipts" where /i
        )
        for (const statement of [compiled[0]!, compiled[2]!]) {
          for (const [index, column] of [
            "sandbox_id",
            "generation",
            "operation",
            "request_id"
          ].entries()) {
            expect(statement.text).toContain(`"${column}" = $${index + 1}`)
          }
        }
        expect(compiled[3]!.text).toMatch(
          /^insert into "command_authority"\."associations" \("sandbox_id", "generation", "job_id", "relations"\) values \(\$1, \$2, \$3, \$4\)$/i
        )
        expect(compiled[4]!.text).toMatch(
          /^insert into "command_authority"\."command_receipts" \("sandbox_id", "generation", "operation", "request_id", "receipt"\) values \(\$1, \$2, \$3, \$4, \$5\)$/i
        )
        expect(
          db.statements.filter((statement) => statement.text === "BEGIN")
        ).toHaveLength(2)
        expect(
          db.statements.filter((statement) => statement.text === "COMMIT")
        ).toHaveLength(2)
        expect(db.statements.some((statement) => /savepoint/i.test(statement.text))).toBe(
          false
        )
      })
    )
  })

  it("keeps empty returning rows unresolved and empty receipt rows absent without write replay", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture({ inserted: [], receipts: [] })
        const services = yield* db.make
        expect(
          yield* services.transactions.owned(access, request, "Scenario", (tx) =>
            Effect.gen(function* () {
              expect(tx.admission).toBe("Unresolved")
              return yield* tx.receipt(request, "Scenario")
            })
          )
        ).toBeNull()
        expect(
          db.statements.filter((statement) => /insert into/i.test(statement.text))
        ).toHaveLength(1)
      })
    )
  })

  it.each([
    { prior: [{ requestId: request.requestId }] },
    { inserted: [{ request_id: null }] },
    { receipts: [{ receipt: null }] },
    { receipts: [{ receipt: JSON.stringify(receipt) }] },
    { budget: 9_007_199_254_740_992n },
    { budget: null },
    { sandbox: { generation: 9_007_199_254_740_992n } },
    { sandbox: { expires_at: null } }
  ])(
    "rejects malformed actual query output %# in the bounded typed channel",
    async (options) => {
      await runPromise(
        Effect.gen(function* () {
          const db = yield* fixture(options)
          const services = yield* db.make
          const exit = yield* Effect.exit(
            services.transactions.owned(access, request, "Scenario", (tx) =>
              tx.receipt(request, "Scenario")
            )
          )
          assertFailure(exit, new PlaygroundError({ code: "unavailable" }))
          expect(
            db.statements.filter((statement) => statement.text === "ROLLBACK")
          ).toHaveLength(1)
        })
      )
    }
  )

  it("rejects a foreign captured client before SQL", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture({ foreignClient: true })
        assertFailure(
          yield* Effect.exit(db.make),
          new CommandTransactionFailure({ commitKnowledge: "NotCommitted" })
        )
        expect(db.statements).toEqual([])
      })
    )
  })

  it("rejects active ownership and escaped typed writes before compilation or SQL", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture()
        const services = yield* db.make
        assertFailure(
          yield* Effect.exit(
            db.client.withTransaction(
              services.transactions.owned(access, request, "Scenario", () => Effect.void)
            )
          ),
          new CommandTransactionFailure({ commitKnowledge: "NotCommitted" })
        )
        const escaped = yield* services.transactions.owned(
          access,
          request,
          "Scenario",
          (tx) => Effect.succeed(tx.saveReceipt(receipt))
        )
        const before = db.statements.length
        assertFailure(
          yield* Effect.exit(escaped),
          new CommandTransactionFailure({ commitKnowledge: "NotCommitted" })
        )
        expect(db.statements).toHaveLength(before)
      })
    )
  })

  it("bounds an actual JSON parameter encoding exception and never sends that statement", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture()
        const services = yield* db.make
        const poisoned = Object.assign({}, receipt, {
          toJSON: () => {
            throw new Error("private-payload-encoding")
          }
        })
        assertFailure(
          yield* Effect.exit(
            services.transactions.owned(access, request, "Scenario", (tx) =>
              tx.saveReceipt(poisoned)
            )
          ),
          new CommandTransactionFailure({ commitKnowledge: "Unknown" })
        )
        expect(
          db.statements.some((statement) =>
            /^insert into "command_authority"\."command_receipts"/i.test(statement.text)
          )
        ).toBe(false)
        expect(
          db.statements.filter((statement) => statement.text === "ROLLBACK")
        ).toHaveLength(1)
      })
    )
  })
})
