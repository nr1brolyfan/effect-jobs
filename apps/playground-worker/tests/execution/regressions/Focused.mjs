import assert from "node:assert/strict"
import { Cause, Context, Effect, Exit, Semaphore, Layer } from "effect"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Documents from "../../../src/scenarios/PrivateDocument.js"
import { SqlClient } from "effect/sql/SqlClient"
import { SqlError, ConnectionError } from "effect/sql/SqlError"
import * as Executor from "../../../src/execution/Executor.js"
import * as Authority from "../../../src/persistence/authority/PostgreSqlAuthority.js"
import { WakeAlarm } from "../../../src/cloudflare/WakeCycle.js"
import { JobWorker } from "../../../../../src/JobWorker.js"
import { JobWorkerUnavailable } from "../../../../../src/JobWorker.js"
import { WorkerCapability } from "../../../../../src/internal/worker/Capability.js"
const checks = []
const queryRow = {
  now: "100000",
  active_until: "115000",
  due: "99000",
  recovery: null,
  generate: null
}
const sql = {
  unsafe: (text) =>
    Effect.succeed(text.startsWith("WITH t AS MATERIALIZED") ? [queryRow] : [])
}
const base = (effect) =>
  effect.pipe(
    Effect.provideService(SqlClient, sql),
    Effect.provideService(Executor.ExecutionHints, { reconcile: Effect.void })
  )
for (const queue of Executor.queueNames) {
  let clears = 0
  const result = await Effect.runPromise(
    Executor.run("review", queue).pipe(
      Effect.provideService(SqlClient, {
        unsafe: (text) =>
          Effect.succeed(
            text.startsWith("WITH t AS MATERIALIZED")
              ? [{ ...queryRow, active_until: null }]
              : []
          )
      }),
      Effect.provideService(Executor.ExecutionHints, {
        reconcile: Effect.die("unexpected hint")
      }),
      Effect.provideService(WakeAlarm, {
        set: () => Effect.die("unexpected alarm"),
        clear: Effect.sync(() => {
          clears++
        })
      })
    )
  )
  assert.equal(result._tag, "Retired")
  assert.equal(clears, 1)
}
checks.push("All four exported queues retire without worker, generation or hint activity")
let alarms = []
const runtime = {
  ready: () => Effect.void,
  permits: () => Effect.succeed(Semaphore.makeUnsafe(2)),
  recover: () => Effect.fail(new JobWorkerUnavailable()),
  claim: () => Effect.die("must not claim after recovery failure")
}
const before = Date.now()
const result = await Effect.runPromise(
  base(Executor.run("review", "playground-media")).pipe(
    Effect.provideService(JobWorker, { [WorkerCapability]: runtime }),
    Effect.provideService(WakeAlarm, {
      set: (at) =>
        Effect.sync(() => {
          alarms.push(at)
        }),
      clear: Effect.void
    })
  )
)
const after = Date.now()
assert.equal(result._tag, "Backoff")
assert.equal(alarms.length, 2)
assert(alarms[1] >= before + 1000 && alarms[1] <= after + 1000)
checks.push("R1 fixed: recovery with overdue Pending schedules 1000ms")
const cases = [
  { phase: "recovery", due: null, expected: 1000 },
  { phase: "claim", due: "99000", expected: 1000 }
]
const scheduleCases = []
for (const c of cases) {
  const observed = []
  const start = Date.now()
  const r = await Effect.runPromise(
    Executor.run("review", "playground-media").pipe(
      Effect.provideService(SqlClient, {
        unsafe: (text) =>
          Effect.succeed(
            text.startsWith("WITH t AS MATERIALIZED") ? [{ ...queryRow, due: c.due }] : []
          )
      }),
      Effect.provideService(Executor.ExecutionHints, { reconcile: Effect.void }),
      Effect.provideService(JobWorker, {
        [WorkerCapability]: {
          ...runtime,
          recover: () =>
            c.phase === "recovery"
              ? Effect.fail(new JobWorkerUnavailable())
              : Effect.succeed(0),
          claim: () => Effect.fail(new JobWorkerUnavailable())
        }
      }),
      Effect.provideService(WakeAlarm, {
        set: (at) =>
          Effect.sync(() => {
            observed.push(at)
          }),
        clear: Effect.void
      })
    )
  )
  const end = Date.now()
  assert.equal(r._tag, "Backoff")
  assert.equal(r.phase, c.phase)
  assert(observed[1] >= start + c.expected && observed[1] <= end + c.expected)
  scheduleCases.push({
    phase: c.phase,
    overdueJob: c.due !== null,
    delayMillis: c.expected
  })
}
// Authority must preserve a mixed SQL failure + defect rather than authorizing a single Unknown.
const defect = new Error("synthetic defect")
const mixed = Cause.fromReasons([
  Cause.makeFailReason(
    new SqlError({ reason: new ConnectionError({ cause: "synthetic SQL" }) })
  ),
  Cause.makeDieReason(defect)
])
const transactionService = Context.Service("review/transaction")
const authoritySql = {
  transactionService,
  unsafe: (text) => Effect.succeed(text.startsWith("WITH t AS MATERIALIZED") ? [] : []),
  withTransaction: () => Effect.failCause(mixed)
}
const services = await Effect.runPromise(
  Authority.make("review").pipe(
    Effect.provideService(SqlClient, authoritySql),
    Effect.provide(Layer.mock(JobEnqueue, {})),
    Effect.provide(Documents.keysLayer)
  )
)
const access = { sandbox: { ref: { sandboxId: "review", generation: 1 } } }
const exit = await Effect.runPromiseExit(
  services.transactions.owned(
    access,
    { sandbox: access.sandbox.ref, requestId: "review" },
    "Scenario",
    () => Effect.void
  )
)
assert(Exit.isFailure(exit))
assert(Cause.hasFails(exit.cause))
assert(Cause.hasDies(exit.cause))
assert.equal(exit.cause.reasons.length, 2)
assert.equal(exit.cause.reasons.find(Cause.isDieReason).defect, defect)
checks.push("Mixed SQL Fail + Die survives transaction controls with original defect")
console.log(
  JSON.stringify(
    {
      runtime: process.versions.bun ?? process.version,
      status: "PASS",
      snapshot: process.env.EXECUTOR_SNAPSHOT,
      result,
      alarmDelayRange: [alarms[1] - after, alarms[1] - before],
      scheduleCases,
      checks
    },
    null,
    2
  )
)
