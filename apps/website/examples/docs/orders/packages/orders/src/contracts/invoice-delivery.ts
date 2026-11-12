import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import { OrderId } from "#orders/contracts/jobs"

// #region delivery-contract
// A recipient-aware contract for the optional delivery recipes.
const invoiceDeliveryJobs = Effect.gen(function* () {
  const SendInvoice = yield* Job.make({
    name: "orders.send-invoice-to-recipient",
    payload: Schema.Struct({ invoiceId: OrderId, recipient: Schema.String })
  })
  // #endregion delivery-contract

  return { SendInvoice }
})
export class InvoiceDeliveryJobs extends Context.Service<
  InvoiceDeliveryJobs,
  Effect.Success<typeof invoiceDeliveryJobs>
>()("orders/InvoiceDeliveryJobs") {}
export const InvoiceDeliveryJobsLayer = Layer.effect(
  InvoiceDeliveryJobs,
  invoiceDeliveryJobs
)
