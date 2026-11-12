import { runPromise } from "../scenarios/Setup.js"
// @effect-diagnostics unstableApiUsage:off
// Exercise pinned native SQL transactions with a deterministic, finite driver.
import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer, Redacted, Stream } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as PgClient from "@effect/sql-pg/PgClient"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { Repairs } from "@effect-jobs/playground-contracts/Repairs"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Authority from "../../src/persistence/authority/PostgreSqlAuthority.js"
import * as Documents from "../../src/scenarios/PrivateDocument.js"
import { Application } from "../../src/server/Services.js"
import * as Http from "../../src/server/HttpApplication.js"
import { LocalPrivate } from "../../src/persistence/authority/PrivateMode.js"

const sqlFailure = () =>
  new SqlError({ reason: new ConnectionError({ cause: "private-provider-diagnostic" }) })
const fixture = (failure?: Cause.Cause<SqlError>, rollbackFails = false) =>
  Effect.gen(function* () {
    const statements: string[] = []
    const row = {
      sandbox_id: Fixtures.sandbox.ref.sandboxId,
      generation: 1,
      expires_at: 100000,
      db_now: 1000,
      demo_owned: true
    }
    const execute: Connection["execute"] = (text) =>
      Effect.suspend(() => {
        statements.push(text)
        if (text === "ROLLBACK" && rollbackFails) {
          return Effect.fail(sqlFailure())
        }
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) {
          return Effect.succeed([])
        }
        return failure ? Effect.failCause(failure) : Effect.succeed([row])
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
      acquirer: Effect.succeed(connection),
      compiler: PgClient.makeCompiler(),
      spanAttributes: []
    }).pipe(Effect.provide(Reactivity.layer))
    const services = yield* Authority.make("authority_cause").pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provide(Layer.mock(JobEnqueue, {})),
      Effect.provide(Documents.keysLayer)
    )
    return { authority: services.authority, statements }
  })

const operations = ["issue", "describe", "authenticate"] as const
const access = { sandbox: Fixtures.sandbox }

describe("authority preserves bounded native failure reasons", () => {
  it("preserves expected domain codes together with rollback defects", async () => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture(undefined, true)
        const result = yield* Effect.exit(
          db.authority.describe({
            sandbox: {
              ...Fixtures.sandbox,
              ref: { ...Fixtures.sandbox.ref, generation: 2 }
            }
          })
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons.map((reason) => reason._tag)).toEqual([
            "Fail",
            "Die"
          ])
          const first = result.cause.reasons[0]!
          if (Cause.isFailReason(first)) {
            expect(first.error).toEqual(new PlaygroundError({ code: "stale-generation" }))
          }
        }
        expect(db.statements.filter((text) => text === "ROLLBACK")).toHaveLength(1)
      })
    )
  })

  it.each(operations)("preserves successful %s without replay", async (operation) => {
    await runPromise(
      Effect.gen(function* () {
        const db = yield* fixture()
        const value = yield* operation === "issue"
          ? db.authority.issue()
          : operation === "describe"
            ? db.authority.describe(access)
            : db.authority.authenticate(Redacted.make("a".repeat(64)))
        expect(value).toBeDefined()
        expect(db.statements.filter((text) => text === "BEGIN")).toHaveLength(
          operation === "authenticate" ? 0 : 1
        )
        expect(db.statements.filter((text) => text === "COMMIT")).toHaveLength(
          operation === "authenticate" ? 0 : 1
        )
      })
    )
  })

  for (const operation of operations) {
    it.each([
      ["Fail", () => Cause.fail(sqlFailure()), ["Fail"]],
      ["Die", () => Cause.die(new Error("private-caller-defect")), ["Die"]],
      [
        "Fail+Die",
        () => Cause.combine(Cause.fail(sqlFailure()), Cause.die("private-caller-defect")),
        ["Fail", "Die"]
      ],
      [
        "Fail+Interrupt",
        () => Cause.combine(Cause.fail(sqlFailure()), Cause.interrupt(41)),
        ["Fail", "Interrupt"]
      ]
    ] as const)(
      `${operation} retains %s structure and bounded diagnostics`,
      async (_name, make, tags) => {
        await runPromise(
          Effect.gen(function* () {
            const original = make()
            const db = yield* fixture(original)
            const result = yield* Effect.exit(
              operation === "issue"
                ? db.authority.issue().pipe(Effect.asVoid)
                : operation === "describe"
                  ? db.authority.describe(access).pipe(Effect.asVoid)
                  : db.authority
                      .authenticate(Redacted.make("a".repeat(64)))
                      .pipe(Effect.asVoid)
            )
            expect(Exit.isFailure(result)).toBe(true)
            if (Exit.isFailure(result)) {
              expect(result.cause.reasons.map((reason) => reason._tag)).toEqual(tags)
              for (const reason of result.cause.reasons) {
                if (Cause.isFailReason(reason)) {
                  expect(reason.error).toEqual(
                    new PlaygroundError({ code: "unavailable" })
                  )
                }
                if (Cause.isDieReason(reason)) {
                  expect(reason.defect).toEqual(new Error("Sandbox authority defect"))
                }
                if (Cause.isInterruptReason(reason)) {
                  expect(reason).toBe(original.reasons.find(Cause.isInterruptReason))
                }
              }
              expect(JSON.stringify(result.cause)).not.toContain("private-")
            }
            expect(db.statements.filter((text) => text === "BEGIN")).toHaveLength(
              operation === "authenticate" ? 0 : 1
            )
          })
        )
      }
    )
  }

  it.each(["issue", "describe"] as const)(
    "%s retains native rollback Die and HTTP exports only unavailable",
    async (operation) => {
      await runPromise(
        Effect.gen(function* () {
          const db = yield* fixture(Cause.fail(sqlFailure()), true)
          const execute = () =>
            operation === "issue"
              ? db.authority.issue().pipe(Effect.asVoid)
              : db.authority.describe(access).pipe(Effect.asVoid)
          const result = yield* Effect.exit(execute())
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            expect(result.cause.reasons.map((reason) => reason._tag)).toEqual([
              "Fail",
              "Die"
            ])
          }
          expect(db.statements.filter((text) => text === "ROLLBACK")).toHaveLength(1)
          const repairs = yield* Repairs.pipe(Effect.provide(Layer.mock(Repairs, {})))
          const response = yield* Http.handle(
            new Request("https://playground.example/api/sandbox/issue", {
              method: "POST",
              headers: {
                Origin: "https://playground.example",
                "Content-Type": "application/json"
              }
            }),
            "https://playground.example",
            () => true
          ).pipe(
            Effect.provide(
              Layer.mock(Application, {
                repairs,
                issue: db.authority.issue
              })
            ),
            Effect.provideService(LocalPrivate, true)
          )
          expect(response.status).toBe(503)
          const text = yield* Effect.promise(() => response.text())
          expect(JSON.parse(text)).toEqual({ code: "unavailable" })
          expect(response.headers.has("Set-Cookie")).toBe(false)
        })
      )
    }
  )
})
