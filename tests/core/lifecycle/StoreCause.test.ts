import assert from "node:assert/strict"
import { Cause, Context, Effect, Exit } from "effect"
import { expect, it } from "vitest"
import * as Store from "../../../src/JobStore.js"
import { makeStore } from "../../../src/postgresql/internal/Store.js"
import {
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "../../../src/postgresql/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../../src/postgresql/PostgreSqlTransaction.js"
import { finalizationRequest, request, token } from "./fixtures.js"

class Diagnostic extends Context.Service<Diagnostic, string>()("test/StoreCause") {}

const unknown = new PostgreSqlFailure({ commitKnowledge: "Unknown" })
const notCommitted = new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
const invalidHandle = new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
const callerDefect = new Error("synthetic caller defect")
const cases: ReadonlyArray<readonly [string, Cause.Cause<PostgreSqlError>]> = [
  ["lone unknown", Cause.fail(unknown)],
  ["not committed", Cause.fail(notCommitted)],
  ["invalid handle", Cause.fail(invalidHandle)],
  ["caller defect", Cause.die(callerDefect)],
  ["interruption", Cause.interrupt(321)],
  ["unknown then defect", Cause.combine(Cause.fail(unknown), Cause.die(callerDefect))],
  ["defect then unknown", Cause.combine(Cause.die(callerDefect), Cause.fail(unknown))],
  ["unknown then interrupt", Cause.combine(Cause.fail(unknown), Cause.interrupt(321))],
  ["interrupt then unknown", Cause.combine(Cause.interrupt(321), Cause.fail(unknown))],
  [
    "multiple unknown failures",
    Cause.fromReasons([Cause.makeFailReason(unknown), Cause.makeFailReason(unknown)])
  ],
  [
    "unknown then ordinary failure",
    Cause.combine(Cause.fail(unknown), Cause.fail(notCommitted))
  ],
  [
    "ordinary failure then unknown",
    Cause.combine(Cause.fail(notCommitted), Cause.fail(unknown))
  ],
  [
    "unknown then handle rejection",
    Cause.combine(Cause.fail(unknown), Cause.fail(invalidHandle))
  ]
]

const operations: ReadonlyArray<
  readonly [
    string,
    (
      store: Store.JobStoreService<PostgreSqlError>
    ) => Effect.Effect<
      unknown,
      PostgreSqlError | Store.JobStoreProtocolError | Store.JobOwnershipLost
    >
  ]
> = [
  ["claim", (store) => store.claim(request)],
  ["reconcileClaim", (store) => store.reconcileClaim(token)],
  [
    "release",
    (store) => store.release(finalizationRequest().ownership, "BeforeExecution")
  ],
  ["finalize", (store) => store.finalize(finalizationRequest())],
  ["reconcileFinalization", (store) => store.reconcileFinalization(finalizationRequest())]
]

for (const operation of operations) {
  it.each(cases)(
    `${operation[0]} preserves %s without replay`,
    async (name, original) => {
      const cause = Cause.annotate(original, Context.make(Diagnostic, "retained"))
      let transactions = 0
      let queries = 0
      const query: TransactionQuery = {
        query: () => {
          queries++
          return Effect.failCause(cause)
        }
      }
      const adapter: ApplicationAdapter = {
        validate: () => Effect.die("unexpected validate"),
        withTransaction: () => Effect.die("unexpected caller transaction"),
        ownedTransaction: (body) =>
          Effect.suspend(() => {
            transactions++
            return body(query)
          })
      }
      const exit = await Effect.runPromiseExit(
        operation[1](makeStore(adapter, "jobs", "payloads", 10))
      )

      if (name === "lone unknown") {
        assert(Exit.isSuccess(exit))
        expect(exit.value).toEqual({ _tag: "Unknown" })
      } else {
        assert(Exit.isFailure(exit))
        expect(exit.cause.reasons).toHaveLength(cause.reasons.length)
        for (let index = 0; index < cause.reasons.length; index++) {
          const actual = exit.cause.reasons[index]!
          const expected = cause.reasons[index]!
          expect(actual._tag).toBe(expected._tag)
          expect(
            Context.getOrUndefined(Cause.reasonAnnotations(actual), Diagnostic)
          ).toBe("retained")
          if (Cause.isFailReason(actual) && Cause.isFailReason(expected)) {
            expect(actual.error).toBe(expected.error)
            // PostgreSQL failures are already sanitized at the application adapter.
            expect(Object.keys(actual.error).sort()).toEqual(
              actual.error instanceof PostgreSqlFailure
                ? ["_tag", "commitKnowledge"]
                : ["_tag", "reason"]
            )
          } else if (Cause.isDieReason(actual) && Cause.isDieReason(expected)) {
            expect(actual.defect).toBe(expected.defect)
          } else if (
            Cause.isInterruptReason(actual) &&
            Cause.isInterruptReason(expected)
          ) {
            expect(actual.fiberId).toBe(expected.fiberId)
          } else {
            assert.fail("reason kind changed")
          }
        }
      }
      expect(transactions).toBe(1)
      expect(queries).toBe(1)
    }
  )
}

it("preserves successful claim and reconciliation values without another transaction", async () => {
  let transactions = 0
  const query: TransactionQuery = {
    query: (sql) =>
      Effect.succeed(sql.startsWith("SELECT floor") ? [{ now: 100_000 }] : [])
  }
  const adapter: ApplicationAdapter = {
    validate: () => Effect.die("unexpected validate"),
    withTransaction: () => Effect.die("unexpected caller transaction"),
    ownedTransaction: (body) =>
      Effect.suspend(() => {
        transactions++
        return body(query)
      })
  }
  const store = makeStore(adapter, "jobs", "payloads", 10)
  expect(await Effect.runPromise(store.claim(request))).toEqual(
    Store.ClaimResults.Empty()
  )
  expect(await Effect.runPromise(store.reconcileClaim(token))).toEqual(
    Store.ClaimReconciliations.NotOwned()
  )
  expect(transactions).toBe(2)
})
