// Deterministic controls supplement the unchanged original reproduction inputs.
import assert from "node:assert/strict"
import { Cause, Effect, Exit, Semaphore } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import {
  Executor,
  Provider,
  Handlers,
  FakeProvider,
  WakeAlarm,
  JobWorker,
  JobWorkerUnavailable,
  WorkerCapability
} from "./Actual.mjs"

const checks = []
for (const field of ["due", "recovery", "generate"]) {
  for (const phase of ["recovery", "claim"]) {
    const alarms = []
    const start = Date.now()
    const result = await Effect.runPromise(
      Executor.run("fixed", "playground-media").pipe(
        Effect.provideService(SqlClient, {
          unsafe: () =>
            Effect.succeed([
              {
                now: "100000",
                active_until: "115000",
                due: null,
                recovery: null,
                generate: null,
                [field]: "99000"
              }
            ])
        }),
        Effect.provideService(Executor.ExecutionHints, { reconcile: Effect.void }),
        Effect.provideService(JobWorker, {
          [WorkerCapability]: {
            ready: () => Effect.void,
            permits: () => Effect.succeed(Semaphore.makeUnsafe(2)),
            recover: () =>
              phase === "recovery"
                ? Effect.fail(new JobWorkerUnavailable())
                : Effect.succeed(0),
            claim: () => Effect.fail(new JobWorkerUnavailable())
          }
        }),
        Effect.provideService(WakeAlarm, {
          set: (at) => Effect.sync(() => alarms.push(at)),
          clear: Effect.void
        })
      )
    )
    const end = Date.now()
    assert.equal(result._tag, "Backoff")
    assert.equal(result.phase, phase)
    assert.equal(alarms.length, 2)
    assert(alarms[0] >= start + 5000 && alarms[0] <= end + 5000)
    assert(alarms[1] >= start + 1000 && alarms[1] <= end + 1000)
    checks.push(`${phase} Backoff ignores overdue ${field}; repair prearm retained`)
  }
}

const queryError = new SqlError({
  reason: new ConnectionError({ cause: "synthetic query" })
})
const defect = new Error("synthetic rollback defect")
const interruption = Cause.makeInterruptReason(777)
const input = Cause.fromReasons([
  Cause.makeFailReason(queryError),
  Cause.makeDieReason(defect),
  interruption,
  Cause.makeFailReason(queryError)
])
const provider = await Effect.runPromise(
  Provider.make("fixed").pipe(
    Effect.provideService(SqlClient, { withTransaction: () => Effect.failCause(input) })
  )
)
const command = {
  sandbox: { sandboxId: "fixed", generation: 1 },
  producer: {
    operation: "playground.synthetic",
    operationId: "fixed",
    slot: "welcome-email"
  },
  workload: "welcome-email",
  behavior: "success",
  semanticProjection: new Uint8Array([42])
}
const exit = await Effect.runPromiseExit(provider.execute(command))
assert(Exit.isFailure(exit))
assert.equal(exit.cause.reasons.length, 4)
const fails = exit.cause.reasons.filter(Cause.isFailReason)
assert.equal(fails.length, 2)
for (const reason of fails) {
  assert.equal(reason.error._tag, "ResponseLost")
  assert.deepEqual(Object.keys(reason.error), ["_tag"])
}
assert.notEqual(fails[0].error, fails[1].error)
assert.equal(exit.cause.reasons.find(Cause.isDieReason).defect, defect)
assert.equal(exit.cause.reasons.find(Cause.isInterruptReason), interruption)

const handlerExit = await Effect.runPromiseExit(
  Handlers.execute("welcome-email")({
    payload: {
      sandbox: command.sandbox,
      version: 1,
      seed: 0,
      sequence: 1,
      behavior: "success",
      actor: "demo-customer",
      tenant: "demo-tenant-a",
      order: "demo-order-a"
    },
    context: { producer: command.producer }
  }).pipe(Effect.provideService(FakeProvider, provider))
)
assert(Exit.isFailure(handlerExit))
assert.equal(handlerExit.cause.reasons.length, 4)
assert.equal(handlerExit.cause.reasons.find(Cause.isDieReason).defect, defect)
// Effect.fn adds stack annotations; interruption identity is its original fiber id.
assert.equal(
  handlerExit.cause.reasons.find(Cause.isInterruptReason).fiberId,
  interruption.fiberId
)
for (const reason of handlerExit.cause.reasons.filter(Cause.isFailReason)) {
  assert.equal(reason.error._tag, "OutcomeUnknown")
}
checks.push(
  "Provider and actual handler retain all defects/interruptions; typed failures are fresh bounded values"
)
console.log(
  JSON.stringify(
    {
      runtime: process.versions.bun ?? process.version,
      snapshot: process.env.EXECUTOR_SNAPSHOT,
      status: "PASS",
      checks
    },
    null,
    2
  )
)
