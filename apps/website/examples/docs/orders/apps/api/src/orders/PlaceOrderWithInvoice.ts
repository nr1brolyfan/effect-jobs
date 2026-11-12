// Native SQL APIs are intentionally pinned to Effect 4.1.0 by this checked example.
// @effect-diagnostics unstableApiUsage:off
import { Effect, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import { Database } from "#database/Database"
import { orders, orderReceipts } from "#database/schema"
import { ApiDefinitions } from "#api/orders/Definitions"

import {
  OrderSubmission,
  OrderConflict,
  matchesSubmission
} from "#api/orders/OrderSubmission"

// #region operation
// Built once by ApiDefinitionsLayer from the shared OrderJobs service.
export const PlaceOrderWithInvoiceDefinition = Effect.map(
  ApiDefinitions,
  (definitions) => definitions.PlaceOrderWithInvoice
)
// #endregion operation

// #region request
// Admission/authorization belongs to the application before this boundary.
export const placeOrderWithInvoice = (externalInput: unknown) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(OrderSubmission)(externalInput, {
      onExcessProperty: "error"
    })

    const { PlaceOrderWithInvoice } = yield* ApiDefinitions
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
        const confirmation = yield* PlaceOrderWithInvoice.enqueue({
          slot: "send-confirmation",
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })

        const invoice = yield* PlaceOrderWithInvoice.enqueue({
          slot: "create-invoice",
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
