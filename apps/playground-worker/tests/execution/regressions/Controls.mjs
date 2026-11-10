import assert from "node:assert/strict"
import { Cause, Context, Effect, Exit, Semaphore } from "effect"
import { SqlClient, makeWithTransaction } from "effect/sql/SqlClient"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import * as Executor from "../../../src/execution/Executor.js"
import * as Provider from "../../../src/execution/PostgreSqlProvider.js"
import { WakeAlarm } from "../../../src/cloudflare/WakeCycle.js"
import { JobWorker } from "../../../../../src/JobWorker.js"
import { JobWorkerUnavailable } from "../../../../../src/JobWorker.js"
import { WorkerCapability } from "../../../../../src/internal/worker/Capability.js"
const results = []
for (const c of [
  { label: "MoreWork overdue", active: 15000, more: true, delay: 100 },
  { label: "Backoff short activation", active: 400, more: false, delay: 400 },
  { label: "Backoff repair ceiling", active: 15000, more: false, delay: 1000 }
]) {
  const alarms = []
  const runtime = {
    ready: () => Effect.void,
    permits: () => Effect.succeed(Semaphore.makeUnsafe(2)),
    recover: () => (c.more ? Effect.succeed(0) : Effect.fail(new JobWorkerUnavailable())),
    claim: () =>
      Effect.succeed({ _tag: "Started", execution: Effect.void, release: Effect.void })
  }
  const start = Date.now()
  const r = await Effect.runPromise(
    Executor.run("triage", "playground-media").pipe(
      Effect.provideService(SqlClient, {
        unsafe: (text) =>
          Effect.succeed(
            text.startsWith("WITH t AS MATERIALIZED")
              ? [
                  {
                    now: "100000",
                    active_until: String(100000 + c.active),
                    due: c.more ? "99000" : null,
                    recovery: null,
                    generate: null
                  }
                ]
              : []
          )
      }),
      Effect.provideService(Executor.ExecutionHints, { reconcile: Effect.void }),
      Effect.provideService(JobWorker, { [WorkerCapability]: runtime }),
      Effect.provideService(WakeAlarm, {
        set: (at) => Effect.sync(() => alarms.push(at)),
        clear: Effect.void
      })
    )
  )
  const end = Date.now()
  assert.equal(r._tag, c.more ? "MoreWork" : "Backoff")
  assert(alarms[1] >= start + c.delay && alarms[1] <= end + c.delay)
  results.push({ control: c.label, result: r._tag, delay: c.delay })
}
const queryError = new SqlError({
  reason: new ConnectionError({ cause: "synthetic query" })
})
const rollbackError = new SqlError({
  reason: new ConnectionError({ cause: "synthetic rollback" })
})
for (const rollbackFails of [false, true]) {
  const withTransaction = makeWithTransaction({
    transactionService: Context.Service("triage/tx"),
    spanAttributes: [],
    acquireConnection: Effect.succeed([undefined, {}]),
    begin: () => Effect.void,
    savepoint: () => Effect.void,
    commit: () => Effect.void,
    rollback: () => (rollbackFails ? Effect.fail(rollbackError) : Effect.void),
    rollbackSavepoint: () => Effect.void
  })
  const raw = await Effect.runPromiseExit(withTransaction(Effect.fail(queryError)))
  assert(Exit.isFailure(raw))
  if (rollbackFails) {
    assert.equal(raw.cause.reasons.find(Cause.isDieReason).defect, rollbackError)
  }
  const provider = await Effect.runPromise(
    Provider.make("triage").pipe(
      Effect.provideService(SqlClient, {
        unsafe: () => Effect.fail(queryError),
        withTransaction
      })
    )
  )
  const exit = await Effect.runPromiseExit(
    provider.execute({
      sandbox: { sandboxId: "triage", generation: 1 },
      producer: {
        operation: "playground.synthetic",
        operationId: "triage",
        slot: "welcome-email"
      },
      workload: "welcome-email",
      behavior: "success",
      semanticProjection: new Uint8Array([42])
    })
  )
  assert(Exit.isFailure(exit))
  assert.equal(exit.cause.reasons.length, rollbackFails ? 2 : 1)
  assert.equal(exit.cause.reasons[0].error._tag, "ResponseLost")
  assert.deepEqual(Object.keys(exit.cause.reasons[0].error), ["_tag"])
  if (rollbackFails) {
    assert.equal(exit.cause.reasons.find(Cause.isDieReason).defect, rollbackError)
  }
  results.push({
    control: rollbackFails
      ? "Mixed Cause retains exact rollback defect"
      : "Single SQL Fail remains bounded",
    rawReasons: raw.cause.reasons.length,
    providerReasons: exit.cause.reasons.length
  })
}
console.log(
  JSON.stringify(
    {
      runtime: process.versions.bun ?? process.version,
      snapshot: process.env.EXECUTOR_SNAPSHOT,
      results
    },
    null,
    2
  )
)
