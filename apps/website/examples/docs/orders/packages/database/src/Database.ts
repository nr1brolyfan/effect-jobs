// Native SQL APIs are intentionally pinned to Effect 4.1.3 by this checked example.
// @effect-diagnostics unstableApiUsage:off
import { Duration, Context, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlNative from "effect-jobs/PostgreSqlNative"
import { JobEnqueue } from "effect-jobs/JobEnqueue"

export class Database extends Context.Service<
  Database,
  Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
>()("orders/Database") {}

// #region setup
const DatabaseLayer = Layer.effect(Database, Drizzle.makeWithDefaults())
const JobsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    const jobs = yield* PostgreSqlJobs.make({
      operationResponseBudget: Duration.millis(100)
    }).pipe(
      Effect.provide(
        PostgreSqlNative.layer({ client: pg, operationTimeout: Duration.millis(2_000) })
      )
    )
    yield* jobs.ready
    return Layer.mergeAll(
      Layer.succeed(PostgreSqlJobs.PostgreSqlJobs, jobs),
      Layer.succeed(JobEnqueue, jobs.producer)
    )
  })
)
export const PersistenceLayer = Layer.mergeAll(DatabaseLayer, JobsLayer)
// Each application supplies its own scoped PgClient Layer with provideMerge.
// Within a process, the same client remains available to transaction owners.
// #endregion setup
