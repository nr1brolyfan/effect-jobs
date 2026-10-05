import { Effect, Layer, Random, Schema } from "effect"
import { JobWorker, JobWorkerConfigurationError } from "./JobWorker.js"
import { EpochMillis } from "./JobPolicy.js"
import { observe } from "./JobTelemetry.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import { drainWithOptions } from "./internal/worker/Drain.js"
import type { JobPlan, JobConsumer } from "./JobConsumer.js"

export interface PollingJobWorkerOptions {
  readonly idlePollMillis?: number
}
const backoffMillis = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const
const sleepWithJitter = (millis: number) =>
  Random.next.pipe(
    Effect.flatMap((random) =>
      Effect.sleep(Math.max(1, Math.round(millis * (0.8 + random * 0.4))))
    )
  )
const loop = (consumer: JobConsumer, idlePollMillis: number) =>
  Effect.gen(function* () {
    let failures = 0
    let recover = true
    yield* Effect.whileLoop({
      while: () => true,
      body: () =>
        Effect.gen(function* () {
          const result = yield* drainWithOptions(consumer, { recover }).pipe(
            observe("polling", "dispatch")
          )
          if (result._tag === "Backoff") {
            if (result.claimed > 0 || (recover && result.phase !== "recovery")) {
              failures = 0
            }
            yield* sleepWithJitter(
              backoffMillis[Math.min(failures, backoffMillis.length - 1)] ?? 30_000
            ).pipe(observe("backoff", "maintenance"))
            failures = Math.min(failures + 1, backoffMillis.length - 1)
            recover = result.phase === "recovery"
          } else {
            failures = 0
            recover = true
            if (result._tag === "Idle") {
              yield* sleepWithJitter(idlePollMillis)
            } else {
              yield* Effect.yieldNow
            }
          }
        }),
      step: () => {}
    })
  })

/** Explicit scoped Node/Bun polling. Imports and constructors start no work. */
export const layerForPlan = (plan: JobPlan, options: PollingJobWorkerOptions = {}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const idlePollMillis = options.idlePollMillis ?? 1_000
      if (!Schema.is(EpochMillis)(idlePollMillis)) {
        return yield* new JobWorkerConfigurationError({ field: "idlePollMillis" })
      }
      const worker = yield* JobWorker
      // Validate the WHOLE plan before starting even one child fiber.
      for (const consumer of plan.consumers) {
        yield* worker[WorkerCapability].ready(consumer.queue.name)
        yield* worker[WorkerCapability].permits(consumer)
      }
      for (const consumer of plan.consumers) {
        yield* loop(consumer, idlePollMillis).pipe(Effect.forkScoped)
      }
    })
  )
