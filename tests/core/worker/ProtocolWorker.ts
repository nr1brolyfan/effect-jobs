/** Protocol fixtures use the engine directly, not a legacy public constructor. */
import { Effect, Layer } from "effect"
import { JobRegistry } from "../definitions/ProtocolRegistry.js"
import type { JobStoreService } from "../../../src/JobStore.js"
import { JobWorker } from "../../../src/JobWorker.js"
import { makeWithHandlers } from "../../../src/internal/worker/Runtime.js"
import type { RuntimeOptions } from "../../../src/internal/worker/Runtime.js"

export {
  JobWorker,
  JobWorkerConfigurationError,
  JobWorkerNotReady,
  JobWorkerUnavailable
} from "../../../src/JobWorker.js"
export type { JobWorkerService } from "../../../src/JobWorker.js"
export { drainWithOptions as drain } from "../../../src/internal/worker/Drain.js"

export const make = Effect.fnUntraced(function* <E, R>(
  store: JobStoreService<E, R>,
  options: RuntimeOptions
) {
  const handlers = yield* JobRegistry
  return yield* makeWithHandlers(store, options, handlers)
})

export const layer = <E, R>(store: JobStoreService<E, R>, options: RuntimeOptions) =>
  Layer.effect(JobWorker, make(store, options))
