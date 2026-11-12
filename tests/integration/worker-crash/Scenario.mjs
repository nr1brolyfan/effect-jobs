/* oxlint-disable effecttsgo/unstable-api-usage -- Integration fixture pins native PgClient to the qualified Effect version. */
import { Duration, Effect, ManagedRuntime, Redacted, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Job from "../../../dist/Job.js"
import * as Queue from "../../../dist/JobQueue.js"
import * as Producer from "../../../dist/JobProducer.js"
import * as Group from "../../../dist/JobGroup.js"
import * as JobApi from "../../../dist/JobApi.js"
import * as Policy from "../../../dist/JobPolicy.js"
import * as Native from "../../../dist/postgresql/PostgreSqlNative.js"
import * as Jobs from "../../../dist/postgresql/PostgreSqlJobs.js"
import * as Tables from "../../../dist/postgresql/PostgreSqlSchema.js"
import { PostgreSqlApplication } from "../../../dist/postgresql/PostgreSqlTransaction.js"

export const mapping = Tables.tables({ schema: "crash_fixture" })
export const migration = Tables.migration(mapping)
export const queue = Queue.make("crash.delivery")
const declarations = Effect.runSync(
  Effect.gen(function* () {
    const definition = yield* Job.make({
      name: "delivery.send",
      payload: Schema.Struct({ consequenceId: Schema.String })
    })
    const policy = yield* Policy.make({
      leaseDuration: Duration.seconds(12),
      attemptTimeout: Duration.seconds(10),
      maxStalledCount: 1
    })
    const producer = yield* Producer.make("crash.enqueue").pipe(
      Producer.withSlot("delivery", definition, { queue, policy })
    )
    return { definition, producer }
  })
)
export const definition = declarations.definition
export const producer = declarations.producer
export const catalog = {
  queue: queue.name,
  name: definition.name,
  version: definition.version
}
export const group = Group.make("crash", { delivery: definition })
export const api = JobApi.make("crash-test").pipe(JobApi.addGroup(group))

export const makeJobs = async (connection) => {
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
    const jobs = await runtime.runPromise(
      Jobs.make({ ...mapping, operationResponseBudgetMillis: 1000 }).pipe(
        Effect.provideService(
          PostgreSqlApplication,
          Native.make({ client, operationTimeoutMillis: 2000 })
        )
      )
    )
    await runtime.runPromise(jobs.ready)
    return { jobs, runtime }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
