import { Schema } from "effect"
import * as Job from "effect-jobs/Job"

export const ReceiptPayload = Schema.Struct({ invoiceId: Schema.String })

export const SendReceipt = Job.make({
  name: "invoice.receipt",
  payload: ReceiptPayload
})
