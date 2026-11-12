import { Context, Effect, Layer } from "effect"
import * as JobProducer from "effect-jobs/JobProducer"
import { OrderJobs, OrdersQueue, OrderPolicy } from "#orders/contracts/jobs"
const workerDefinitions = Effect.gen(function* () {
  const policy = yield* OrderPolicy
  const { SendInvoice } = yield* OrderJobs
  const InvoiceCreated = yield* JobProducer.make("invoice.create").pipe(
    JobProducer.withSlot("send-invoice", SendInvoice, { queue: OrdersQueue, policy })
  )
  return { InvoiceCreated }
})
export class WorkerDefinitions extends Context.Service<
  WorkerDefinitions,
  Effect.Success<typeof workerDefinitions>
>()("orders/WorkerDefinitions") {}
export const WorkerDefinitionsLayer = Layer.effect(WorkerDefinitions, workerDefinitions)
