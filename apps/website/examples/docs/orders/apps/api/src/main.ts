import { Config, Effect, Layer } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { NodeRuntime } from "@effect/platform-node"
import { ApplicationLayer } from "#database/Database"
import { placeOrder } from "#api/orders/PlaceOrder"
import { placeOrderWithInvoice } from "#api/orders/PlaceOrderWithInvoice"

export const ClientLayer = PgClient.layerConfig({
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
const ProducerLayer = ApplicationLayer.pipe(Layer.provideMerge(ClientLayer))
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
NodeRuntime.runMain(submit.pipe(Effect.provide(ProducerLayer)))
// #endregion composition
