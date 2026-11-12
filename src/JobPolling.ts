/**
 * Explicit Node/Bun polling owned by the application Layer Scope.
 */
import { Effect, FiberSet, Layer, Random, Schema, Scope } from "effect"
import { JobWorker, JobWorkerConfigurationError, JobWorkerNotReady } from "./JobWorker.js"
import { EpochMillis } from "./JobPolicy.js"
import { observe } from "./JobTelemetry.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import { drainWithOptions } from "./internal/worker/Drain.js"
import { runFor, DrainLimitsSchema } from "./internal/worker/GroupWorker.js"
import type { DrainLimits } from "./JobWorker.js"
import type { JobQueue } from "./JobQueue.js"
import type { QueueRun } from "./internal/worker/QueueRun.js"

/**
 * Polling configuration; idlePollMillis defaults to 1,000 positive integer
 * milliseconds. Idle/backoff sleeps include jitter. shutdownGraceMillis defaults
 * to 30,000; integer 0–300,000, with zero requesting immediate interruption.
 *
 * @category models
 */
export interface Options extends DrainLimits {
  readonly idlePollMillis?: number
  readonly shutdownGraceMillis?: number
}
const OptionsSchema = Schema.Struct({
  ...DrainLimitsSchema.fields,
  idlePollMillis: EpochMillis.pipe(Schema.optionalKey),
  shutdownGraceMillis: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 300_000 })),
    Schema.optionalKey
  )
})
const backoffMillis = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const
const sleepWithJitter = (millis: number) =>
  Random.next.pipe(
    Effect.flatMap((random) =>
      Effect.sleep(Math.max(1, Math.round(millis * (0.8 + random * 0.4))))
    )
  )
const loop = (
  consumer: QueueRun,
  idlePollMillis: number,
  executions: FiberSet.FiberSet<void, never>
) =>
  Effect.gen(function* () {
    let failures = 0
    let recover = true
    yield* Effect.whileLoop({
      while: () => true,
      body: () =>
        Effect.gen(function* () {
          const result = yield* drainWithOptions(consumer, { recover, executions }).pipe(
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
 * Validates all queues before forking. Scope closure first interrupts admission
 * loops, including permit waits, recovery and in-flight claims. Already-started
 * executions retain their scopes and can finalize during one shared grace period.
 * After grace expiry remaining executions are interrupted, never released as safe
 * unexecuted work. Unknown effects remain subject to lease recovery.
 * Source acquisition/control/release and handler finalizers must be finitely bounded
 * and interruption-cooperative; a grace timer cannot hard-kill arbitrary native or
 * uninterruptible user code. One-shot drain interruption remains immediate.
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
        runFor(queue, {
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
      // One owner finalizer controls both sets even if the surrounding Scope uses
      // parallel finalizers. Neither set can close before the graceful wait.
      const lifetime = yield* Effect.acquireRelease(
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          const executions = yield* Scope.provide(scope)(FiberSet.make<void, never>())
          const admissions = yield* Scope.provide(scope)(
            FiberSet.make<void, JobWorkerConfigurationError | JobWorkerNotReady>()
          )
          return { scope, executions, admissions }
        }),
        (owned, exit) =>
          Effect.gen(function* () {
            yield* FiberSet.clear(owned.admissions)
            if ((decoded.shutdownGraceMillis ?? 30_000) > 0) {
              // Only the race children are interruptible. Restoring interruptibility
              // on the finalizer itself would re-observe the shutdown interruption
              // and skip grace when the application is interrupted.
              yield* Effect.raceFirst(
                FiberSet.awaitEmpty(owned.executions).pipe(Effect.interruptible),
                Effect.sleep(decoded.shutdownGraceMillis ?? 30_000).pipe(
                  Effect.interruptible
                )
              )
            }
          }).pipe(Effect.ensuring(Scope.close(owned.scope, exit)))
      )
      for (const consumer of consumers) {
        yield* FiberSet.run(
          lifetime.admissions,
          loop(consumer, idlePollMillis, lifetime.executions)
        )
      }
    })
  )
