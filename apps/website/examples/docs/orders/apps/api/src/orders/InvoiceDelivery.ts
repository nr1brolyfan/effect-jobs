import * as JobRetryPolicy from "effect-jobs/JobRetryPolicy"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { Duration, Effect } from "effect"
import { ApiDefinitions } from "#api/orders/Definitions"

// #region delivery-identities
// Keep these declarations with the use cases that execute these business actions.
// These effects join the caller's existing transaction; no implicit transaction.
export const initialDelivery = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InitialInvoiceDelivery.enqueue({
    slot: "recipient",
    operationId: "invoice-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const deliberateResend = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.ResendInvoice.enqueue({
    slot: "recipient",
    operationId: "resend-request-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const customerCopy = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InvoiceCopies.enqueue({
    slot: "customer",
    operationId: "copy-request-1",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" }
  })
)
export const accountantCopy = Effect.flatMap(ApiDefinitions, (definitions) =>
  definitions.InvoiceCopies.enqueue({
    slot: "accountant",
    operationId: "copy-request-1",
    payload: { invoiceId: "invoice-1", recipient: "accounts@example.test" }
  })
)
// #endregion delivery-identities

// #region policy-override
// This complete override replaces the declaration default for first insertion.
export const urgentResend = Effect.gen(function* () {
  const definitions = yield* ApiDefinitions
  const policy = yield* JobPolicy.make({
    retry: JobRetryPolicy.fixed(Duration.seconds(5)).pipe(
      JobRetryPolicy.maxFinalizedAttempts(1)
    )
  })
  return yield* definitions.ResendInvoice.enqueue({
    slot: "recipient",
    operationId: "resend-request-2",
    payload: { invoiceId: "invoice-1", recipient: "customer@example.test" },
    policy
  })
})
// #endregion policy-override
