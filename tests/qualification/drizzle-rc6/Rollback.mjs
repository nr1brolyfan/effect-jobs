import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Redacted } from "effect"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlFailure } from "effect-jobs/PostgreSqlTransaction"

// The disposable server closes an idle transaction before its body returns a
// typed failure. Compare with the acknowledged-rollback control on a live PID.
// Unlike a mocked SqlClient, this exercises the driver's actual rollback path.
export const qualifyRollback = (url, Pg, tag) => {
  const options = { url: Redacted.make(url), maxConnections: 1 }
  return Effect.runPromise(
    Effect.gen(function* () {
      const observer = yield* tag
      yield* Effect.gen(function* () {
        const writer = yield* tag
        assert.notEqual(observer, writer)
        const adapter = Native.make({
          client: writer,
          operationTimeout: Duration.seconds(10)
        })
        const domainError = new Error("typed application failure")
        for (const expire of [false, true]) {
          let calls = 0
          const exit = yield* Effect.exit(
            adapter.ownedTransaction((query) =>
              Effect.gen(function* () {
                calls++
                const [{ pid }] = yield* query.query("select pg_backend_pid() as pid")
                const count = observer.unsafe(
                  "select count(*)::int as n from pg_stat_activity where pid=$1",
                  [pid]
                )
                assert.equal((yield* count)[0].n, 1)
                if (expire) {
                  yield* query.query(
                    "set local idle_in_transaction_session_timeout='150ms'"
                  )
                  // An independent session must actually observe disconnection before
                  // releasing the body. A fixed delay alone is not this oracle.
                  const deadline = performance.now() + 5000
                  while ((yield* count)[0].n !== 0) {
                    assert(performance.now() < deadline, "idle session did not close")
                    yield* Effect.sleep("25 millis")
                  }
                }
                return yield* Effect.fail(domainError)
              })
            )
          )
          assert.equal(calls, 1)
          assert(Exit.isFailure(exit))
          const reasons = exit.cause.reasons
          assert(Cause.isFailReason(reasons[0]) && reasons[0].error === domainError)
          if (!expire) {
            assert.equal(reasons.length, 1, "acknowledged rollback adds no uncertainty")
          } else {
            assert(
              reasons.some(
                (r) =>
                  Cause.isFailReason(r) &&
                  r.error instanceof PostgreSqlFailure &&
                  r.error.commitKnowledge === "Unknown"
              ),
              "failed ROLLBACK missing from Cause after observed session expiry"
            )
          }
        }
      }).pipe(Effect.provide(Pg.layer(options)))
    }).pipe(Effect.provide(Pg.layer(options)))
  )
}
