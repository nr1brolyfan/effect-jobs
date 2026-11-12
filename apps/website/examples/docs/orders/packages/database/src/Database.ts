// Native SQL APIs are intentionally pinned to Effect 4.0.5 by this checked example.
// @effect-diagnostics unstableApiUsage:off
import { Context, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlNative from "effect-jobs/PostgreSqlNative"
import { JobEnqueue } from "effect-jobs/JobEnqueue"

import { OrderJobsLayer } from "#orders/contracts/jobs"
import { InvoiceDeliveryJobsLayer } from "#orders/contracts/invoice-delivery"
import { ApiDefinitionsLayer } from "#api/orders/Definitions"
import { WorkerDefinitionsLayer } from "#worker/orders/Definitions"

export class Database extends Context.Service<
  Database,
  Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
>()("orders/Database") {}

// #region setup
const DatabaseLayer = Layer.effect(Database, Drizzle.makeWithDefaults())
const JobsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    const backend = yield* PostgreSqlJobs.make({
      operationResponseBudgetMillis: 100
    }).pipe(
      Effect.provide(
        PostgreSqlNative.layer({ client: pg, operationTimeoutMillis: 2_000 })
      )
    )
    yield* backend.ready
    return Layer.mergeAll(
      Layer.succeed(PostgreSqlJobs.PostgreSqlJobs, backend),
      Layer.succeed(JobEnqueue, backend.producer)
    )
  })
)
export const ApplicationLayer = Layer.mergeAll(
  DatabaseLayer,
  JobsLayer,
  ApiDefinitionsLayer,
  WorkerDefinitionsLayer
).pipe(Layer.provideMerge(Layer.mergeAll(OrderJobsLayer, InvoiceDeliveryJobsLayer)))
// Supply ONE application-owned scoped PgClient Layer with provideMerge.
// The same client remains available to application transaction owners.
// #endregion setup
