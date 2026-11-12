import { Context, Effect, Layer } from "effect"
import * as JobProducer from "effect-jobs/JobProducer"
import { OrderJobs } from "#orders/contracts/jobs"
import { InvoiceDeliveryJobs } from "#orders/contracts/invoice-delivery"

const apiDefinitions = Effect.gen(function* () {
  const { SendOrderConfirmation, CreateOrderInvoice } = yield* OrderJobs
  const { SendInvoice } = yield* InvoiceDeliveryJobs
  const PlaceOrder = yield* JobProducer.make({
    operation: "order.place",
    slots: { "send-confirmation": SendOrderConfirmation }
  })
  const PlaceOrderWithInvoice = yield* JobProducer.make({
    operation: "order.place",
    slots: {
      "send-confirmation": SendOrderConfirmation,
      "create-invoice": CreateOrderInvoice
    }
  })
  const InitialInvoiceDelivery = yield* JobProducer.make({
    operation: "invoice.initial-delivery",
    slots: { recipient: SendInvoice }
  })
  const ResendInvoice = yield* JobProducer.make({
    operation: "invoice.resend",
    slots: { recipient: SendInvoice }
  })
  const InvoiceCopies = yield* JobProducer.make({
    operation: "invoice.copies",
    slots: { customer: SendInvoice, accountant: SendInvoice }
  })
  return {
    PlaceOrder,
    PlaceOrderWithInvoice,
    InitialInvoiceDelivery,
    ResendInvoice,
    InvoiceCopies
  }
})
export class ApiDefinitions extends Context.Service<
  ApiDefinitions,
  Effect.Success<typeof apiDefinitions>
>()("orders/ApiDefinitions") {}
export const ApiDefinitionsLayer = Layer.effect(ApiDefinitions, apiDefinitions)
