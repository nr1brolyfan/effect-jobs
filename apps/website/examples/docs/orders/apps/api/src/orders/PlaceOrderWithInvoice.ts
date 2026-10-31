import { Effect, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import * as JobProducer from "effect-jobs/JobProducer"
import { Database } from "#database/Database"
import { orders, orderReceipts } from "#database/schema"
import { SendOrderConfirmation, CreateOrderInvoice } from "#orders/contracts/jobs"

import {
  OrderSubmission,
  OrderConflict,
  matchesSubmission
} from "#api/orders/OrderSubmission"

// #region operation
export const PlaceOrderWithInvoice = JobProducer.make({
  operation: "order.place",
  slots: {
    "send-confirmation": SendOrderConfirmation,
    "create-invoice": CreateOrderInvoice
  }
})
// #endregion operation

// #region request
// Admission/authorization belongs to the application before this boundary.
export const placeOrderWithInvoice = (externalInput: unknown) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(OrderSubmission)(externalInput, {
      onExcessProperty: "error"
    })

    const db = yield* Database
    const pg = yield* PgClient.PgClient

    return yield* pg.withTransaction(
      Effect.gen(function* () {
        // Persist the order; on replay, reuse and check the existing submission.
        yield* db
          .insert(orders)
          .values({ ...input, invoiceRequested: true })
          .onConflictDoNothing({ target: orders.operationId })

        // Check all business fields, including the original invoice choice.
        const [saved] = yield* db
          .select()
          .from(orders)
          .where(eq(orders.operationId, input.operationId))
          .limit(1)

        if (!matchesSubmission(saved, input, true)) {
          return yield* new OrderConflict()
        }

        // Enqueue both independent consequences atomically with the order.
        const confirmation = yield* PlaceOrderWithInvoice.enqueue("send-confirmation", {
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })

        const invoice = yield* PlaceOrderWithInvoice.enqueue("create-invoice", {
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })

        // Retain the committed operation-to-job mapping for reconciliation.
        yield* db
          .insert(orderReceipts)
          .values({
            operationId: input.operationId,
            confirmationJobId: confirmation.jobId,
            invoiceJobId: invoice.jobId
          })
          .onConflictDoNothing({ target: orderReceipts.operationId })

        return { confirmation, invoice }
      })
    )
  })
// #endregion request
