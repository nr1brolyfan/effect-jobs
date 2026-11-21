import { Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"

export const deliveryProducer = Effect.gen(function* () {
  const queue = yield* JobQueue.make("campaign-deliveries")
  const SendDelivery = yield* Job.make({
    name: "campaign.send-delivery",
    payload: Schema.Struct({ recipientId: Schema.String })
  })
  return yield* JobProducer.make("campaign.deliver").pipe(
    JobProducer.withSlot("send", SendDelivery, { queue })
  )
})

interface Delivery {
  readonly id: string
  readonly recipientId: string
}

// #region fan-out
// Pass validated delivery records loaded from application storage.
export const enqueueDeliveries = Effect.fnUntraced(function* (
  deliveries: ReadonlyArray<Delivery>
) {
  const Deliver = yield* deliveryProducer
  for (const delivery of deliveries) {
    yield* Deliver.enqueueStandalone({
      operationId: delivery.id,
      slot: "send",
      payload: { recipientId: delivery.recipientId }
    })
  }
})
// #endregion fan-out
