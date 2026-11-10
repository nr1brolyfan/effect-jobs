import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { OrderId, OrdersQueue } from "#orders/contracts/jobs"

// #region delivery-contract
// A recipient-aware contract for the optional delivery recipes.
export const SendInvoice = Job.make({
  name: "orders.send-invoice-to-recipient",
  queue: OrdersQueue,
  payload: Schema.Struct({ invoiceId: OrderId, recipient: Schema.String }),
  defaultPolicy: JobPolicy.defaultPolicy
})
// #endregion delivery-contract
