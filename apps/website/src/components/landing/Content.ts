/** Syntax regions from the landing example; checked by tests/Content.mjs. */
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

export const shared = `export const orderJobDefinitions = Effect.gen(function* () {
  const OrdersQueue = yield* JobQueue.make("orders")
  const ConfirmationJob = yield* Job.make({
    name: "orders.send-confirmation",
    payload: Schema.Struct({ orderId: Schema.String })
  })
  const ConfirmationJobGroup = yield* JobGroup.make("confirmation", {
    confirmation: ConfirmationJob
  })
  const OrdersJobApi = yield* JobApi.make("orders").pipe(
    JobApi.addGroup(ConfirmationJobGroup)
  )
  const PlaceOrder = yield* JobProducer.make("order.place").pipe(
    JobProducer.withSlot("send-confirmation", ConfirmationJob, {
      queue: OrdersQueue
    })
  )
  return { OrdersQueue, ConfirmationJobGroup, OrdersJobApi, PlaceOrder }
})`

export const handler = `const HandlerLayer = JobGroup.handlers(ConfirmationJobGroup, (handlers) =>
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

const setupImport = 'import { orderJobDefinitions } from "./shared/jobs/orders.js"'

export const apiSetup = `${setupImport}

const { PlaceOrder } = yield* orderJobDefinitions`

export const workerSetup = `${setupImport}

const { OrdersQueue, ConfirmationJobGroup, OrdersJobApi } = yield* orderJobDefinitions`
