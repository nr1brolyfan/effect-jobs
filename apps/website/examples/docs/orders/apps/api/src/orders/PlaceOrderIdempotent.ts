// Advanced application replay: validate retained business fields and keep a receipt.
// #region imports
import { Effect, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import { Database } from "#database/Database"
import { orders, orderReceipts } from "#database/schema"
import {
  OrderSubmission,
  OrderConflict,
  matchesSubmission
} from "#api/orders/OrderSubmission"
import { PlaceOrder } from "#api/orders/PlaceOrder"

// #endregion imports

// #region request
// Admission/authorization belongs to the application before this boundary.
export const placeOrderIdempotent = (externalInput: unknown) =>
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
          .values({ ...input, invoiceRequested: false })
          .onConflictDoNothing({ target: orders.operationId })

        // Read the retained business fields: job deduplication cannot check them.
        const [saved] = yield* db
          .select()
          .from(orders)
          .where(eq(orders.operationId, input.operationId))
          .limit(1)

        if (!matchesSubmission(saved, input, false)) {
          return yield* new OrderConflict()
        }

        // Enqueue the consequence and record its receipt in this same transaction.
        const confirmation = yield* PlaceOrder.enqueue("send-confirmation", {
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })

        yield* db
          .insert(orderReceipts)
          .values({
            operationId: input.operationId,
            confirmationJobId: confirmation.jobId
          })
          .onConflictDoNothing({ target: orderReceipts.operationId })

        return confirmation
      })
    )
  })
// #endregion request

// #region reconcile
// Read on the primary, OUTSIDE the uncertain transaction. No write or replay.
export const readOrderReceipt = (operationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* db
      .select()
      .from(orderReceipts)
      .where(eq(orderReceipts.operationId, operationId))
      .limit(1)
  })
// Absence does not establish NotCommitted or authorize replay.
// #endregion reconcile
