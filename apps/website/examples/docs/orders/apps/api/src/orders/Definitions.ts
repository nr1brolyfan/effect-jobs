import { Context, Effect, Layer } from "effect"
import * as JobProducer from "effect-jobs/JobProducer"
import { OrderJobs, OrdersQueue, OrderPolicy } from "#orders/contracts/jobs"
import { InvoiceDeliveryJobs } from "#orders/contracts/invoice-delivery"

const apiDefinitions = Effect.gen(function* () {
  const policy = yield* OrderPolicy
  const { SendOrderConfirmation, CreateOrderInvoice } = yield* OrderJobs
  const { SendInvoice } = yield* InvoiceDeliveryJobs
  const PlaceOrder = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", SendOrderConfirmation, {
      queue: OrdersQueue,
      policy
    })
  )
  const PlaceOrderWithInvoice = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", SendOrderConfirmation, {
      queue: OrdersQueue,
      policy
    }),
    JobProducer.withSlot("create-invoice", CreateOrderInvoice, {
      queue: OrdersQueue,
      policy
    })
  )
  const InitialInvoiceDelivery = yield* JobProducer.make("invoice.initial-delivery").pipe(
    JobProducer.withSlot("recipient", SendInvoice, { queue: OrdersQueue, policy })
  )
  const ResendInvoice = yield* JobProducer.make("invoice.resend").pipe(
    JobProducer.withSlot("recipient", SendInvoice, { queue: OrdersQueue, policy })
  )
  const InvoiceCopies = yield* JobProducer.make("invoice.copies").pipe(
    JobProducer.withSlot("customer", SendInvoice, { queue: OrdersQueue, policy }),
    JobProducer.withSlot("accountant", SendInvoice, { queue: OrdersQueue, policy })
  )
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
