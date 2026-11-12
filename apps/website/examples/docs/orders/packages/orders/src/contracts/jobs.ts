// #region shared-contract
import { Context, Duration, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobApi from "effect-jobs/JobApi"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as JobRetryPolicy from "effect-jobs/JobRetryPolicy"

export const OrderPolicy = JobPolicy.make({
  retry: JobRetryPolicy.fixed(Duration.seconds(5)).pipe(
    JobRetryPolicy.maxFinalizedAttempts(3)
  )
})

export const OrdersQueue = JobQueue.make("orders")

export const OrderId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))
)

export const SendOrderConfirmation = Job.make({
  name: "orders.send-confirmation",
  payload: Schema.Struct({ orderId: OrderId })
})
// #endregion shared-contract

// #region invoice-contracts
export const CreateOrderInvoice = Job.make({
  name: "orders.create-invoice",
  payload: Schema.Struct({ orderId: OrderId })
})

export const SendInvoice = Job.make({
  name: "orders.send-invoice",
  payload: Schema.Struct({ invoiceId: OrderId })
})
// #endregion invoice-contracts

export const orderJobs = Effect.gen(function* () {
  const confirmation = yield* SendOrderConfirmation
  const invoice = yield* CreateOrderInvoice
  const delivery = yield* SendInvoice
  const ConfirmationJobs = JobGroup.make("confirmation", { confirmation })
  const InvoiceJobs = JobGroup.make("invoice", { invoice })
  const DeliveryJobs = JobGroup.make("delivery", { delivery })
  const ConfirmationApi = JobApi.make("confirmations").pipe(
    JobApi.addGroup(ConfirmationJobs)
  )
  const ApplicationJobs = JobApi.make("orders").pipe(
    JobApi.addGroup(ConfirmationJobs),
    JobApi.addGroup(InvoiceJobs),
    JobApi.addGroup(DeliveryJobs)
  )
  return {
    ConfirmationJobs,
    InvoiceJobs,
    DeliveryJobs,
    ConfirmationApi,
    ApplicationJobs,
    SendOrderConfirmation: confirmation,
    CreateOrderInvoice: invoice,
    SendInvoice: delivery
  }
})
export class OrderJobs extends Context.Service<
  OrderJobs,
  Effect.Success<typeof orderJobs>
>()("orders/OrderJobs") {}
export const OrderJobsLayer = Layer.effect(OrderJobs, orderJobs)
