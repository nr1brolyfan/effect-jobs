import assert from "node:assert/strict"
import { Cause, Context, Effect, Exit } from "effect"
import { SqlClient, makeWithTransaction } from "effect/sql/SqlClient"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Provider from "../../../src/execution/PostgreSqlProvider.js"
const queryError = new SqlError({
  reason: new ConnectionError({ cause: "synthetic query connection loss" })
})
const rollbackError = new SqlError({
  reason: new ConnectionError({ cause: "synthetic rollback connection loss" })
})
// Real Effect 4.0.0 transaction manager; only its driver operations are deterministic fixtures.
const withTransaction = makeWithTransaction({
  transactionService: Context.Service("review/provider-transaction"),
  spanAttributes: [],
  acquireConnection: Effect.succeed([undefined, {}]),
  begin: () => Effect.void,
  savepoint: () => Effect.void,
  commit: () => Effect.void,
  rollback: () => Effect.fail(rollbackError),
  rollbackSavepoint: () => Effect.fail(rollbackError)
})
const unsafe = () => Effect.fail(queryError)
const raw = await Effect.runPromiseExit(withTransaction(unsafe()))
assert(Exit.isFailure(raw))
assert(Cause.hasFails(raw.cause))
assert(Cause.hasDies(raw.cause))
assert.equal(raw.cause.reasons.length, 2)
const provider = await Effect.runPromise(
  Provider.make("review").pipe(
    Effect.provideService(SqlClient, { unsafe, withTransaction })
  )
)
const actual = await Effect.runPromiseExit(
  provider.execute({
    sandbox: { sandboxId: "review", generation: 1 },
    producer: {
      operation: "playground.synthetic",
      operationId: "review",
      slot: "welcome-email"
    },
    workload: "welcome-email",
    behavior: "success",
    semanticProjection: new Uint8Array([42])
  })
)
assert(Exit.isFailure(actual))
assert.equal(actual.cause.reasons.length, 2)
assert.equal(actual.cause.reasons[0].error._tag, "ResponseLost")
assert.equal(Cause.hasDies(actual.cause), true)
assert.equal(actual.cause.reasons.find(Cause.isDieReason).defect, rollbackError)
console.log(
  JSON.stringify(
    {
      runtime: process.versions.bun ?? process.version,
      snapshot: process.env.EXECUTOR_SNAPSHOT,
      status: "PASS",
      input:
        "Query ConnectionError followed by rollback ConnectionError through real SqlClient.makeWithTransaction",
      expected: { reasons: 2, fail: "ResponseLost", rollbackDefectRetained: true },
      transactionManagerActual: {
        reasons: raw.cause.reasons.length,
        fail: Cause.hasFails(raw.cause),
        die: Cause.hasDies(raw.cause)
      },
      providerActual: {
        reasons: actual.cause.reasons.length,
        fail: actual.cause.reasons[0].error._tag,
        die: Cause.hasDies(actual.cause)
      }
    },
    null,
    2
  )
)
