import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { SendInvoice } from "#orders/contracts/invoice-delivery"

// #region delivery-identities
// Keep these declarations with the use cases that execute these business actions.
export const InitialInvoiceDelivery = JobProducer.make({
  operation: "invoice.initial-delivery",
  slots: { recipient: SendInvoice }
})
export const ResendInvoice = JobProducer.make({
  operation: "invoice.resend",
  slots: { recipient: SendInvoice }
})
export const InvoiceCopies = JobProducer.make({
  operation: "invoice.copies",
  slots: { customer: SendInvoice, accountant: SendInvoice }
})
// These effects join the caller's existing transaction; no implicit transaction.
export const initialDelivery = InitialInvoiceDelivery.enqueue("recipient", {
  operationId: "invoice-1",
  payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
})
export const deliberateResend = ResendInvoice.enqueue("recipient", {
  operationId: "resend-request-1",
  payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
})
export const customerCopy = InvoiceCopies.enqueue("customer", {
  operationId: "copy-request-1",
  payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
})
export const accountantCopy = InvoiceCopies.enqueue("accountant", {
  operationId: "copy-request-1",
  payload: { invoiceId: "invoice-1", recipient: "accounts@example.test" }
})
// #endregion delivery-identities

// #region policy-override
// This complete override replaces the declaration default for first insertion.
export const urgentResend = ResendInvoice.enqueue("recipient", {
  operationId: "resend-request-2",
  payload: { invoiceId: "invoice-1", recipient: "customer@example.test" },
  policy: JobPolicy.make({ maxAttempts: 1 })
})
// #endregion policy-override
