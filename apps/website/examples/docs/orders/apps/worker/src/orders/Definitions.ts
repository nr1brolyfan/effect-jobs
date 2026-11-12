import { Context, Effect, Layer } from "effect"
import * as JobProducer from "effect-jobs/JobProducer"
import { OrderJobs } from "#orders/contracts/jobs"
const workerDefinitions = Effect.gen(function* () {
  const { SendInvoice } = yield* OrderJobs
  const InvoiceCreated = yield* JobProducer.make({
    operation: "invoice.create",
    slots: { "send-invoice": SendInvoice }
  })
  return { InvoiceCreated }
})
export class WorkerDefinitions extends Context.Service<
  WorkerDefinitions,
  Effect.Success<typeof workerDefinitions>
>()("orders/WorkerDefinitions") {}
export const WorkerDefinitionsLayer = Layer.effect(WorkerDefinitions, workerDefinitions)
