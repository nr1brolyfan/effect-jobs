// #region shared-contract
import { Duration, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobPolicy from "effect-jobs/JobPolicy"

export const OrderPolicy = JobPolicy.make({
  maxAttempts: 3,
  retryDelay: Duration.seconds(5)
})

export const OrdersQueue = JobQueue.make("orders")

export const OrderId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))
)

export const SendOrderConfirmation = Job.make({
  queue: OrdersQueue,
  name: "orders.send-confirmation",
  payload: Schema.Struct({ orderId: OrderId }),
  defaultPolicy: OrderPolicy
})
// #endregion shared-contract

// #region invoice-contracts
export const CreateOrderInvoice = Job.make({
  queue: OrdersQueue,
  name: "orders.create-invoice",
  payload: Schema.Struct({ orderId: OrderId }),
  defaultPolicy: OrderPolicy
})

export const SendInvoice = Job.make({
  queue: OrdersQueue,
  name: "orders.send-invoice",
  payload: Schema.Struct({ invoiceId: OrderId }),
  defaultPolicy: OrderPolicy
})
// #endregion invoice-contracts
