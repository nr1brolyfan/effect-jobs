// Platform and native SQL APIs are intentionally pinned to Effect 4.1.3 here.
// @effect-diagnostics unstableApiUsage:off
import { pathToFileURL } from "node:url"
import { Duration, Config, Effect, Layer, Match } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { NodeRuntime } from "@effect/platform-node"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as JobWorker from "effect-jobs/JobWorker"
import * as JobStorage from "effect-jobs/JobStorage"
import * as JobPolling from "effect-jobs/JobPolling"
import { PersistenceLayer } from "#database/Database"
import { OrderJobs, OrderJobsLayer, OrdersQueue } from "#orders/contracts/jobs"
import { WorkerDefinitionsLayer } from "#worker/orders/Definitions"
import { ConfirmationHandlerLayer } from "#worker/orders/jobs/SendConfirmation"
import { InvoiceHandlerLayer } from "#worker/orders/jobs/CreateInvoice"
import { InvoiceDeliveryHandlerLayer } from "#worker/orders/jobs/SendInvoice"
import * as SyntheticMail from "#worker/orders/SyntheticMail"

// #region confirmation-composition
export const ConfirmationWorkerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { ConfirmationApi } = yield* OrderJobs
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs

    // The catalog declares what can run; the handler Layer installs the implementation.
    return JobWorker.layer(ConfirmationApi, {
      queues: [{ queue: OrdersQueue, concurrency: 2 }]
    }).pipe(
      Layer.provide(ConfirmationHandlerLayer),
      Layer.provide(SyntheticMail.layer),
      Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage))
    )
  })
)

// Building the Layer doesn't claim jobs. The drain is the execution boundary.
export const drainConfirmations = JobWorker.drain(OrdersQueue, {
  maxJobs: 20,
  recoveryLimit: 20
}).pipe(Effect.provide(ConfirmationWorkerLayer))
// #endregion confirmation-composition

// #region composition
export const WorkerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { ApplicationJobs } = yield* OrderJobs
    const jobs = yield* PostgreSqlJobs.PostgreSqlJobs

    return JobWorker.layer(ApplicationJobs, {
      queues: [{ queue: OrdersQueue, concurrency: 2 }]
    }).pipe(
      Layer.provide([
        ConfirmationHandlerLayer,
        InvoiceHandlerLayer,
        InvoiceDeliveryHandlerLayer
      ]),
      Layer.provide(SyntheticMail.layer),
      Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage))
    )
  })
)

export const drainOrders = JobWorker.drain(OrdersQueue, {
  maxJobs: 20,
  recoveryLimit: 20
}).pipe(Effect.provide(WorkerLayer))
// #endregion composition

// #region polling
// Keep the polling Layer scoped to this process; shutdown closes it.
export const pollOrders = Effect.never.pipe(
  Effect.provide(
    JobPolling.layer([OrdersQueue], {
      maxJobs: 20,
      recoveryLimit: 20,
      shutdownGrace: Duration.millis(30_000)
    }).pipe(Layer.provide(WorkerLayer))
  ),
  Effect.scoped
)
// #endregion polling

export const WorkerApplicationLayer = Layer.mergeAll(
  PersistenceLayer,
  WorkerDefinitionsLayer
).pipe(Layer.provideMerge(OrderJobsLayer))

const ClientLayer = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  connectTimeout: Config.succeed("2 seconds"),
  idleTimeout: Config.succeed("10 seconds"),
  startupParameters: Config.succeed({
    statement_timeout: "2000",
    lock_timeout: "1000",
    idle_in_transaction_session_timeout: "5000"
  })
})
const program = Effect.gen(function* () {
  const mode = yield* Config.Literals(
    ["confirmation", "drain", "poll"],
    "WORKER_MODE"
  ).pipe(Config.withDefault("drain"))
  return yield* Match.value(mode).pipe(
    Match.when("poll", () => pollOrders),
    Match.when("confirmation", () => drainConfirmations),
    Match.when("drain", () => drainOrders),
    Match.exhaustive
  )
}).pipe(Effect.provide(WorkerApplicationLayer.pipe(Layer.provideMerge(ClientLayer))))

// Execute only when invoked as a CLI; importing composition starts no worker.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(program)
}
