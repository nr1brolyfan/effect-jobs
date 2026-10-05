import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Consumer from "../../src/JobConsumer.js"
import * as Codec from "../../src/JobPayloadCodec.js"
import * as Worker from "../../src/JobWorker.js"
import { drain } from "../../src/JobWorkerRuntime.js"
import { layerForPlan } from "../../src/PollingJobWorker.js"
import type { JobStoreService } from "../../src/JobStore.js"
import type { JobRegistry, DuplicateJobHandler } from "../../src/JobRegistry.js"

class Provider extends Context.Service<
  Provider,
  { readonly read: Effect.Effect<void> }
>()("types/worker/provider") {}
class HandlerDependency extends Context.Service<
  HandlerDependency,
  { readonly send: Effect.Effect<void> }
>()("types/worker/handler") {}
declare const store: JobStoreService<string, Provider>
const definition = Job.make({
  queue: Queue.make("types"),
  kind: "message",
  version: 1,
  payload: Schema.Struct({ text: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
const installed: Layer.Layer<
  never,
  DuplicateJobHandler,
  JobRegistry | HandlerDependency
> = definition.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const dependency = yield* HandlerDependency
      const text: string = payload.text
      const attempt: number = context.attemptNumber
      void text
      void attempt
      // @ts-expect-error handlers do not receive ownership powers
      void context.leaseToken
      // @ts-expect-error handlers do not receive transactions
      void context.transaction
      // @ts-expect-error handlers do not receive finalization powers
      context.finalize()
      yield* dependency.send
    }),
  Codec.decodeJobPayload
)
void installed

const made: Effect.Effect<
  Worker.JobWorkerService,
  Worker.JobWorkerConfigurationError,
  Provider | JobRegistry
> = Worker.make(store, { catalog: [definition], operationResponseBudgetMillis: 100 })
void made
const built: Layer.Layer<
  Worker.JobWorker,
  Worker.JobWorkerConfigurationError,
  Provider | JobRegistry
> = Worker.layer(store, { catalog: [definition], operationResponseBudgetMillis: 100 })
void built
declare const consumer: Consumer.JobConsumer
declare const plan: Consumer.JobPlan
const drained: Effect.Effect<
  import("../../src/JobWorkerRuntime.js").DrainResult,
  Worker.JobWorkerNotReady | Worker.JobWorkerConfigurationError,
  Worker.JobWorker
> = drain(consumer)
void drained
const polling: Layer.Layer<
  never,
  Worker.JobWorkerNotReady | Worker.JobWorkerConfigurationError,
  Worker.JobWorker
> = layerForPlan(plan)
void polling
// @ts-expect-error the worker requires explicit finite backend response configuration
const missingBudget = Worker.make(store, { catalog: [definition] })
void missingBudget
// @ts-expect-error no domain handler error classifier callback
layerForPlan(plan, { classifyError: () => "Retry" })
// @ts-expect-error internal hooks are not public polling configuration
layerForPlan(plan, { beforeExecutionBoundary: Effect.void })
