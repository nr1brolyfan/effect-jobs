/* oxlint-disable effecttsgo/unstable-api-usage -- Integration fixture pins native PgClient to the qualified Effect version. */
import { Duration, Effect, ManagedRuntime, Redacted, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Job from "../../../dist/Job.js"
import * as Queue from "../../../dist/JobQueue.js"
import * as Policy from "../../../dist/JobPolicy.js"
import * as Native from "../../../dist/PostgreSqlNative.js"
import * as Jobs from "../../../dist/PostgreSqlJobs.js"
import * as Tables from "../../../dist/PostgreSqlSchema.js"
import { PostgreSqlApplication } from "../../../dist/PostgreSqlTransaction.js"

export const mapping = Tables.tables({ schema: "crash_fixture" })
export const migration = Tables.migration(mapping)
export const queue = Queue.make("crash.delivery")
export const definition = Job.make({
  name: "delivery.send",
  queue,
  payload: Schema.Struct({ consequenceId: Schema.String }),
  defaultPolicy: Policy.make({
    leaseDuration: Duration.seconds(12),
    attemptTimeout: Duration.seconds(10),
    maxStalledCount: 1
  })
})

export const makeBackend = async (connection) => {
  const runtime = ManagedRuntime.make(
    PgClient.layer({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: "crash_runtime",
      password: Redacted.make(connection.password),
      applicationName: "worker-crash-test",
      maxConnections: 4,
      connectTimeout: "2 seconds",
      startupParameters: {
        statement_timeout: "2000",
        lock_timeout: "1000",
        idle_in_transaction_session_timeout: "5000"
      }
    })
  )
  try {
    const client = await runtime.runPromise(PgClient.PgClient)
    const backend = await runtime.runPromise(
      Jobs.make({ ...mapping, operationResponseBudgetMillis: 1000 }).pipe(
        Effect.provideService(
          PostgreSqlApplication,
          Native.make({ client, operationTimeoutMillis: 2000 })
        )
      )
    )
    await runtime.runPromise(backend.ready)
    return { backend, runtime }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
