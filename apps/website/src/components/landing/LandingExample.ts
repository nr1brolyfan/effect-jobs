// Landing-owned, compile-checked composition. The host supplies one configured
// PgClient, PostgreSqlJobs and an email adapter with mapped JobFailure outcomes.
// @effect-diagnostics unstableApiUsage:off
import { Context, Data, Effect, Layer, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { integer, pgTable, text } from "drizzle-orm/pg-core"
import * as Job from "effect-jobs/Job"
import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobStorage from "effect-jobs/JobStorage"
import * as JobWorker from "effect-jobs/JobWorker"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import type { JobFailure } from "effect-jobs/JobFailure"

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

// #region shared
const OrdersQueue = JobQueue.make("orders")
const orderJobDefinitions = Effect.gen(function* () {
  const ConfirmationJob = yield* Job.make({
    name: "orders.send-confirmation",
    payload: Schema.Struct({ orderId: Schema.String })
  })
  const ConfirmationJobGroup = JobGroup.make("confirmation", {
    confirmation: ConfirmationJob
  })
  const OrdersJobApi = JobApi.make("orders").pipe(JobApi.addGroup(ConfirmationJobGroup))
  const PlaceOrder = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", ConfirmationJob, {
      queue: OrdersQueue
    })
  )
  return { OrdersJobApi, PlaceOrder }
})
// #endregion shared

// Application input is already admitted and validated at its boundary. No work
// starts on import or construction; the caller evaluates placeOrder/processJobs.
export const example = Effect.gen(function* () {
  const { OrdersJobApi, PlaceOrder } = yield* orderJobDefinitions
  const pg = yield* PgClient.PgClient
  const db = yield* Drizzle.makeWithDefaults()
  const jobs = yield* PostgreSqlJobs.PostgreSqlJobs

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

  // #region handler
  const HandlerLayer = JobApiBuilder.group(OrdersJobApi, "confirmation", (handlers) =>
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

  return { placeOrder, rollbackOrder, processJobs }
})
