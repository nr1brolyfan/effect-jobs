import * as JobPolicy from "effect-jobs/JobPolicy"
import { Effect } from "effect"
import { ApiDefinitions } from "#api/orders/Definitions"

// #region delivery-identities
// Keep these declarations with the use cases that execute these business actions.
// These effects join the caller's existing transaction; no implicit transaction.
export const initialDelivery = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InitialInvoiceDelivery.enqueue("recipient", {
    operationId: "invoice-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const deliberateResend = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.ResendInvoice.enqueue("recipient", {
    operationId: "resend-request-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const customerCopy = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InvoiceCopies.enqueue("customer", {
    operationId: "copy-request-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const accountantCopy = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InvoiceCopies.enqueue("accountant", {
    operationId: "copy-request-1",
    payload: { invoiceId: "invoice-1", recipient: "accounts@example.test" }
  })
)
// #endregion delivery-identities

// #region policy-override
// This complete override replaces the declaration default for first insertion.
export const urgentResend = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.ResendInvoice.enqueue("recipient", {
    operationId: "resend-request-2",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" },
    policy: JobPolicy.make({ maxAttempts: 1 })
  })
)
// #endregion policy-override
