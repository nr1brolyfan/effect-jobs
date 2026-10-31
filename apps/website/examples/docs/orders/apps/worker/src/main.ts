import { Config, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { NodeRuntime } from "@effect/platform-node"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as JobRegistry from "effect-jobs/JobRegistry"
import * as JobWorker from "effect-jobs/JobWorker"
import * as JobConsumer from "effect-jobs/JobConsumer"
import * as JobWorkerRuntime from "effect-jobs/JobWorkerRuntime"
import * as PollingJobWorker from "effect-jobs/PollingJobWorker"
import { ApplicationLayer } from "#database/Database"
import {
  SendOrderConfirmation,
  CreateOrderInvoice,
  SendInvoice,
  OrdersQueue
} from "#orders/contracts/jobs"
import { ConfirmationHandlerLayer } from "#worker/orders/jobs/SendConfirmation"
import { InvoiceHandlerLayer } from "#worker/orders/jobs/CreateInvoice"
import { InvoiceDeliveryHandlerLayer } from "#worker/orders/jobs/SendInvoice"
import * as SyntheticMail from "#worker/orders/SyntheticMail"

// #region confirmation-composition
export const ConfirmationWorkerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    return JobWorker.layer(backend.store, {
      catalog: [SendOrderConfirmation],
      operationResponseBudgetMillis: 100
    }).pipe(
      Layer.provide(ConfirmationHandlerLayer),
      Layer.provide(SyntheticMail.layer),
      Layer.provide(JobRegistry.layer)
    )
  })
)
export const confirmationConsumer = JobConsumer.make(OrdersQueue, {
  localConcurrency: 2,
  claimLimitPerRun: 20,
  recoveryLimitPerRun: 20
})
export const drainConfirmations = Effect.gen(function* () {
  const configured = yield* confirmationConsumer
  return yield* JobWorkerRuntime.drain(configured)
}).pipe(Effect.provide(ConfirmationWorkerLayer))
// #endregion confirmation-composition

// #region composition
export const WorkerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    return JobWorker.layer(backend.store, {
      catalog: [SendOrderConfirmation, CreateOrderInvoice, SendInvoice],
      operationResponseBudgetMillis: 100
    }).pipe(
      Layer.provide([
        ConfirmationHandlerLayer,
        InvoiceHandlerLayer,
        InvoiceDeliveryHandlerLayer
      ]),
      Layer.provide(SyntheticMail.layer),
      Layer.provide(JobRegistry.layer)
    )
  })
)
export const consumer = JobConsumer.make(OrdersQueue, {
  localConcurrency: 2,
  claimLimitPerRun: 20,
  recoveryLimitPerRun: 20
})
export const drainOrders = Effect.gen(function* () {
  const configured = yield* consumer
  return yield* JobWorkerRuntime.drain(configured)
}).pipe(Effect.provide(WorkerLayer))

export const pollOrders = Effect.gen(function* () {
  const configured = yield* consumer
  const plan = yield* JobConsumer.plan(configured)
  return yield* Effect.never.pipe(
    Effect.provide(PollingJobWorker.layerForPlan(plan).pipe(Layer.provide(WorkerLayer)))
  )
}).pipe(Effect.scoped)
// #endregion composition

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
  return yield* mode === "poll"
    ? pollOrders
    : mode === "confirmation"
      ? drainConfirmations
      : drainOrders
}).pipe(Effect.provide(ApplicationLayer.pipe(Layer.provideMerge(ClientLayer))))

// Execute only when invoked as a CLI; importing composition starts no worker.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  NodeRuntime.runMain(program)
}
