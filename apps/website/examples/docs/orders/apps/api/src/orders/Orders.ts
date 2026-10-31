import { Effect } from "effect"
import { Database } from "#database/Database"
import { orders } from "#database/schema"
import type { OrderSubmission } from "#api/orders/OrderSubmission"
import { TransactionalEmails } from "#api/orders/TransactionalEmails"

// #region request
// The application has already validated and authorized this submission.
export const placeOrder = (input: OrderSubmission) =>
  Effect.gen(function* () {
    const db = yield* Database
    const emails = yield* TransactionalEmails

    // Save the order to the database.
    yield* db.insert(orders).values({ ...input, invoiceRequested: false })

    // After saving to the database, send the confirmation email.
    yield* emails.sendOrderConfirmation(input.orderId)
  })
// #endregion request
