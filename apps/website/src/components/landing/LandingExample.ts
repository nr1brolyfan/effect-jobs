// Landing-owned, compile-checked composition. The host supplies one configured
// PgClient, PostgreSqlJobs and an email adapter with mapped JobFailure outcomes.
// @effect-diagnostics unstableApiUsage:off
import { Context, Data, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { integer, pgTable, text } from "drizzle-orm/pg-core"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobStorage from "effect-jobs/JobStorage"
import * as JobWorker from "effect-jobs/JobWorker"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import type { JobFailure } from "effect-jobs/JobFailure"
// #region setupImport
import { orderJobDefinitions } from "./shared/jobs/orders.js"
// #endregion setupImport

interface OrderInput {
  readonly orderId: string
  readonly operationId: string
  readonly sku: string
  readonly quantity: number
}

const orders = pgTable("orders", {
  operationId: text("operation_id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull()
})

class OrderRejected extends Data.TaggedError("OrderRejected")<{}> {}

export class TransactionalEmails extends Context.Service<
  TransactionalEmails,
  {
    readonly send: (message: {
      readonly deliveryKey: string
      readonly orderId: string
    }) => Effect.Effect<void, JobFailure>
  }
>()("landing/TransactionalEmails") {}

// Application input is already admitted and validated at its boundary.
const apiSetup = Effect.gen(function* () {
  // #region apiSetup
  const { PlaceOrder } = yield* orderJobDefinitions
  // #endregion apiSetup
  const pg = yield* PgClient.PgClient
  const db = yield* Drizzle.makeWithDefaults()

  // #region transaction
  const placeOrder = (input: OrderInput) =>
    pg.withTransaction(
      Effect.gen(function* () {
        yield* db.insert(orders).values(input)

        return yield* PlaceOrder.enqueue({
          slot: "send-confirmation",
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })
      })
    )
  // #endregion transaction

  // #region rollback
  const rollbackOrder = (input: OrderInput) =>
    pg.withTransaction(
      Effect.gen(function* () {
        yield* db.insert(orders).values(input)
        yield* PlaceOrder.enqueue({
          slot: "send-confirmation",
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })
        return yield* new OrderRejected()
      })
    )
  // #endregion rollback

  return { placeOrder, rollbackOrder }
})

const workerSetup = Effect.gen(function* () {
  // #region workerSetup
  const { OrdersQueue, ConfirmationJobGroup, OrdersJobApi } = yield* orderJobDefinitions
  // #endregion workerSetup
  const jobs = yield* PostgreSqlJobs.PostgreSqlJobs

  // #region handler
  const HandlerLayer = JobGroup.handlers(ConfirmationJobGroup, (handlers) =>
    handlers.handle("confirmation", (input) =>
      Effect.gen(function* () {
        const emails = yield* TransactionalEmails
        yield* emails.send({
          deliveryKey: input.context.jobId,
          orderId: input.payload.orderId
        })
      })
    )
  )
  // #endregion handler

  // #region execution
  const WorkerLayer = JobWorker.layer(OrdersJobApi, {
    queues: [{ queue: OrdersQueue, concurrency: 2 }]
  }).pipe(
    Layer.provide(HandlerLayer),
    Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage))
  )
  const processJobs = JobWorker.drain(OrdersQueue, {
    maxJobs: 20,
    recoveryLimit: 20
  }).pipe(Effect.provide(WorkerLayer))
  // #endregion execution

  return processJobs
})

// The caller explicitly evaluates placeOrder or processJobs.
export const example = Effect.gen(function* () {
  const { placeOrder, rollbackOrder } = yield* apiSetup
  const processJobs = yield* workerSetup
  return { placeOrder, rollbackOrder, processJobs }
})
