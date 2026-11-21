import { Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobApi from "effect-jobs/JobApi"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"

// #region shared
export const orderJobDefinitions = Effect.gen(function* () {
  const OrdersQueue = yield* JobQueue.make("orders")
  const ConfirmationJob = yield* Job.make({
    name: "orders.send-confirmation",
    payload: Schema.Struct({ orderId: Schema.String })
  })
  const ConfirmationJobGroup = yield* JobGroup.make("confirmation", {
    confirmation: ConfirmationJob
  })
  const OrdersJobApi = yield* JobApi.make("orders").pipe(
    JobApi.addGroup(ConfirmationJobGroup)
  )
  const PlaceOrder = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", ConfirmationJob, {
      queue: OrdersQueue
    })
  )
  return { OrdersQueue, ConfirmationJobGroup, OrdersJobApi, PlaceOrder }
})
// #endregion shared
