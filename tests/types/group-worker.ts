import * as JobApi from "../../src/JobApi.js"
import { Context, Effect, Schema } from "effect"
import * as Group from "../../src/JobGroup.js"
import * as Queue from "../../src/JobQueue.js"
import * as Worker from "../../src/JobWorker.js"
import * as Storage from "../../src/JobStorage.js"
import type { JobStoreService } from "../../src/JobStore.js"

class Database extends Context.Service<Database, {}>()("types/group-worker/Database") {}
declare const store: JobStoreService<"provider-error", Database>
const definitions = {
  receipt: { kind: "billing.receipt", version: 1, payload: Schema.String }
} as const
const group = Group.make("billing-worker", definitions)
const queue = Queue.make("billing")
export const made = Worker.make(JobApi.make(group.name).pipe(JobApi.addGroup(group)), {
  queues: [{ queue, concurrency: 2 }]
})
export const storage = Storage.layer({ store, operationResponseBudgetMillis: 100 })
export const composed = made.pipe(Effect.provide(storage))

type ExpectFalse<T extends false> = T
export type GroupIsRequired = ExpectFalse<
  typeof made extends Effect.Effect<unknown, unknown, Storage.JobStorage> ? true : false
>
export type ConfiguredStorageIsRequired = ExpectFalse<
  typeof made extends Effect.Effect<
    unknown,
    unknown,
    Group.Handlers<"billing-worker", typeof definitions>
  >
    ? true
    : false
>
export type ProviderServicesAreRequired = ExpectFalse<
  typeof composed extends Effect.Effect<
    unknown,
    unknown,
    Group.Handlers<"billing-worker", typeof definitions>
  >
    ? true
    : false
>
declare const worker: Effect.Success<typeof made>
export const invalidDrain = worker.drain(queue, {
  // @ts-expect-error Concurrency belongs to worker construction, not a drain.
  concurrency: 3
})
export const invalidBudget = Worker.make(
  JobApi.make(group.name).pipe(JobApi.addGroup(group)),
  {
    queues: [{ queue }],
    // @ts-expect-error The worker cannot duplicate or override its storage budget.
    operationResponseBudgetMillis: 200
  }
)
