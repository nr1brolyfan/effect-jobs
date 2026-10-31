// #region imports
import { Effect, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as JobProducer from "effect-jobs/JobProducer"
import { Database } from "#database/Database"
import { orders } from "#database/schema"
import { SendOrderConfirmation } from "#orders/contracts/jobs"
import { OrderSubmission } from "#api/orders/OrderSubmission"
// #endregion imports

// #region operation
export const PlaceOrder = JobProducer.make({
  operation: "order.place",
  slots: { "send-confirmation": SendOrderConfirmation }
})
// #endregion operation

// #region request
// Admission/authorization belongs to the application before this boundary.
export const placeOrder = (externalInput: unknown) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(OrderSubmission)(externalInput, {
      onExcessProperty: "error"
    })
    const db = yield* Database
    const pg = yield* PgClient.PgClient

    return yield* pg.withTransaction(
      Effect.gen(function* () {
        // Create a new order; a duplicate operationId rejects the transaction.
        yield* db.insert(orders).values({ ...input, invoiceRequested: false })

        // Commit the order and its confirmation instruction together.
        return yield* PlaceOrder.enqueue("send-confirmation", {
          operationId: input.operationId,
          payload: { orderId: input.orderId }
        })
      })
    )
  })
// #endregion request
