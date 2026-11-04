/**
 * Explicit Node/Bun polling owned by the application Layer Scope.
 */
import { Effect, Layer, Random, Schema } from "effect"
import { JobWorker, JobWorkerConfigurationError } from "./JobWorker.js"
import { EpochMillis } from "./JobPolicy.js"
import { observe } from "./JobTelemetry.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import { drainWithOptions } from "./internal/worker/Drain.js"
import { consumerFor, DrainLimitsSchema } from "./internal/worker/GroupWorker.js"
import type { DrainLimits } from "./JobWorker.js"
import type { JobQueue } from "./JobQueue.js"
import type { JobConsumer } from "./JobConsumer.js"

/**
 * Polling configuration; idlePollMillis defaults to 1,000 positive integer
 * milliseconds. Idle/backoff sleeps include jitter.
 *
 * @category models
 */
export interface Options extends DrainLimits {
  readonly idlePollMillis?: number
}
const OptionsSchema = Schema.Struct({
  ...DrainLimitsSchema.fields,
  idlePollMillis: EpochMillis.pipe(Schema.optionalKey)
})
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

/**
 * Starts one scoped loop per queue when the Layer is built, requiring JobWorker.
 * Validates all queues before forking; Scope closure interrupts the loops.
 * Build only in the application-owned lifetime; importing or constructing starts no work.
 *
 * @category layers
 */
export const layer = (queues: ReadonlyArray<JobQueue>, options: Options = {}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(OptionsSchema)(options, {
        onExcessProperty: "error"
      }).pipe(
        Effect.mapError(() => new JobWorkerConfigurationError({ field: "polling" }))
      )
      const idlePollMillis = decoded.idlePollMillis ?? 1_000
      if (!Schema.is(EpochMillis)(idlePollMillis)) {
        return yield* new JobWorkerConfigurationError({ field: "idlePollMillis" })
      }
      if (
        queues.length === 0 ||
        new Set(queues.map((queue) => queue.name)).size !== queues.length
      ) {
        return yield* new JobWorkerConfigurationError({ field: "queues" })
      }
      const worker = yield* JobWorker
      // Validate every queue and limit before starting even one child fiber.
      const consumers = yield* Effect.forEach(queues, (queue) =>
        consumerFor(queue, {
          ...(decoded.maxJobs === undefined ? {} : { maxJobs: decoded.maxJobs }),
          ...(decoded.recoveryLimit === undefined
            ? {}
            : { recoveryLimit: decoded.recoveryLimit })
        })
      )
      for (const consumer of consumers) {
        yield* worker[WorkerCapability].ready(consumer.queue.name)
        yield* worker[WorkerCapability].permits(consumer)
      }
      for (const consumer of consumers) {
        yield* loop(consumer, idlePollMillis).pipe(Effect.forkScoped)
      }
    })
  )
