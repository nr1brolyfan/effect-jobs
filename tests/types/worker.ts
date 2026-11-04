import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Group from "../../src/JobGroup.js"
import * as Worker from "../../src/JobWorker.js"
import * as Storage from "../../src/JobStorage.js"
import * as Polling from "../../src/JobPolling.js"
import type { JobStoreService } from "../../src/JobStore.js"

class Provider extends Context.Service<
  Provider,
  { readonly read: Effect.Effect<void> }
>()("types/worker/provider") {}
class HandlerDependency extends Context.Service<
  HandlerDependency,
  { readonly send: Effect.Effect<void> }
>()("types/worker/handler") {}
declare const store: JobStoreService<string, Provider>
const queue = Queue.make("types")
const definition = Job.make({
  kind: "message",
  payload: Schema.Struct({ text: Schema.String })
})
const group = Group.make("typed-worker", { message: definition })
const installed: Layer.Layer<
  Group.Handlers<"typed-worker", typeof group.definitions>,
  Group.JobGroupConfigurationError,
  HandlerDependency
> = group.toLayer({
  message: (input) =>
    Effect.gen(function* () {
      const dependency = yield* HandlerDependency
      const text: string = input.payload.text
      const attempt: number = input.context.nextFinalizationNumber
      void text
      void attempt
      // @ts-expect-error Handlers do not receive ownership powers.
      void input.context.leaseToken
      // @ts-expect-error Handlers do not receive transactions.
      void input.context.transaction
      // @ts-expect-error Handlers do not receive finalization powers.
      input.context.finalize()
      yield* dependency.send
    })
})
void installed
const storage = { store, operationResponseBudgetMillis: 100 }
const made: Effect.Effect<
  Worker.JobWorkerService,
  Worker.JobWorkerConfigurationError,
  Storage.JobStorage | Group.Handlers<"typed-worker", typeof group.definitions>
> = Worker.make(group, { queues: [{ queue }] })
void made
const built: Layer.Layer<
  Worker.JobWorker,
  Worker.JobWorkerConfigurationError,
  Storage.JobStorage | Group.Handlers<"typed-worker", typeof group.definitions>
> = Worker.layer(group, { queues: [{ queue }] })
void built
export const capturedStorage: Layer.Layer<
  Storage.JobStorage,
  Storage.JobStorageConfigurationError,
  Provider
> = Storage.layer(storage)
export const composed: Effect.Effect<
  Worker.JobWorkerService,
  Worker.JobWorkerConfigurationError | Storage.JobStorageConfigurationError,
  Provider | Group.Handlers<"typed-worker", typeof group.definitions>
> = made.pipe(Effect.provide(capturedStorage))
const drained: Effect.Effect<
  Worker.DrainResult,
  Worker.JobWorkerNotReady | Worker.JobWorkerConfigurationError,
  Worker.JobWorker
> = Worker.drain(queue)
void drained
const polling: Layer.Layer<
  never,
  Worker.JobWorkerNotReady | Worker.JobWorkerConfigurationError,
  Worker.JobWorker
> = Polling.layer([queue], { shutdownGraceMillis: 1000 })
void polling
// @ts-expect-error Response budget comes from configured storage, not a worker argument.
export const explicitStorage = Worker.make(group, storage, { queues: [{ queue }] })
// @ts-expect-error Configured storage requires its admission reserve.
export const missingBudget = Storage.layer({ store })
// @ts-expect-error No domain error classifier callback.
Polling.layer([queue], { classifyError: () => "Retry" })
// @ts-expect-error Internal hooks are not public polling configuration.
Polling.layer([queue], { beforeExecutionBoundary: Effect.void })
// @ts-expect-error Drain concurrency is fixed at worker construction.
export const perDrainConcurrency = Worker.drain(queue, { concurrency: 2 })
Polling.layer([
  // @ts-expect-error Polling accepts queues, not consumer/plan configurations.
  { queue, localConcurrency: 2, claimLimitPerRun: 10, recoveryLimitPerRun: 10 }
])
