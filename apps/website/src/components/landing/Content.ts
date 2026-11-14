/** Complete syntax regions from LandingExample.ts; checked by tests/Content.mjs. */
export const transaction = `const placeOrder = (input: OrderInput) =>
  pg.withTransaction(
    Effect.gen(function* () {
      yield* db.insert(orders).values(input)

      return yield* PlaceOrder.enqueue({
        slot: "send-confirmation",
        operationId: input.operationId,
        payload: { orderId: input.orderId }
      })
    })
  )`

export const rollback = `const rollbackOrder = (input: OrderInput) =>
  pg.withTransaction(
    Effect.gen(function* () {
      yield* db.insert(orders).values(input)
      yield* PlaceOrder.enqueue({
        slot: "send-confirmation",
        operationId: input.operationId,
        payload: { orderId: input.orderId }
      })
      return yield* new OrderRejected()
    })
  )`

export const shared = `const OrdersQueue = JobQueue.make("orders")
const orderJobDefinitions = Effect.gen(function* () {
  const ConfirmationJob = yield* Job.make({
    name: "orders.send-confirmation",
    payload: Schema.Struct({ orderId: Schema.String })
  })
  const ConfirmationJobGroup = JobGroup.make("confirmation", {
    confirmation: ConfirmationJob
  })
  const OrdersJobApi = JobApi.make("orders").pipe(
    JobApi.addGroup(ConfirmationJobGroup)
  )
  const PlaceOrder = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", ConfirmationJob, {
      queue: OrdersQueue
    })
  )
  return { OrdersJobApi, PlaceOrder }
})`

export const handler = `const HandlerLayer = JobApiBuilder.group(
  OrdersJobApi, "confirmation", (handlers) =>
    handlers.handle("confirmation", (input) =>
      Effect.gen(function* () {
        const emails = yield* TransactionalEmails
        yield* emails.send({
          deliveryKey: input.context.jobId,
          orderId: input.payload.orderId
        })
      })
    )
)`

export const execution = `const WorkerLayer = JobWorker.layer(OrdersJobApi, {
  queues: [{ queue: OrdersQueue, concurrency: 2 }]
}).pipe(
  Layer.provide(HandlerLayer),
  Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage))
)
const processJobs = JobWorker.drain(OrdersQueue, {
  maxJobs: 20, recoveryLimit: 20
}).pipe(Effect.provide(WorkerLayer))`
