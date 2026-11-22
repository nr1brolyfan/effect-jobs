// Platform and native SQL APIs are intentionally pinned to Effect 4.1.3 here.
// @effect-diagnostics unstableApiUsage:off
import { Config, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { NodeRuntime } from "@effect/platform-node"
import { PersistenceLayer } from "#database/Database"
import { OrderJobsLayer } from "#orders/contracts/jobs"
import { InvoiceDeliveryJobsLayer } from "#orders/contracts/invoice-delivery"
import { ApiDefinitionsLayer } from "#api/orders/Definitions"
import { placeOrder } from "#api/orders/PlaceOrder"
import { placeOrderWithInvoice } from "#api/orders/PlaceOrderWithInvoice"

const ClientLayer = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  connectTimeout: Config.succeed("2 seconds"),
  idleTimeout: Config.succeed("10 seconds"),
  startupParameters: Config.succeed({
    statement_timeout: "2000",
    lock_timeout: "1000",
    idle_in_transaction_session_timeout: "5000"
  })
})

// #region composition
export const ProducerLayer = Layer.mergeAll(PersistenceLayer, ApiDefinitionsLayer).pipe(
  Layer.provideMerge(Layer.mergeAll(OrderJobsLayer, InvoiceDeliveryJobsLayer))
)
const submit = Effect.gen(function* () {
  const operationId = yield* Config.String("OPERATION_ID")
  const orderId = yield* Config.String("ORDER_ID")
  const withInvoice = yield* Config.Boolean("WITH_INVOICE").pipe(
    Config.withDefault(false)
  )
  const input = { operationId, orderId, sku: "book", quantity: 1 }
  return yield* withInvoice ? placeOrderWithInvoice(input) : placeOrder(input)
})
// CLI boundary; an HTTP host instead supplies its admitted/authorized request.
if (import.meta.main) {
  NodeRuntime.runMain(
    submit.pipe(Effect.provide(ProducerLayer.pipe(Layer.provideMerge(ClientLayer))))
  )
}
// #endregion composition
