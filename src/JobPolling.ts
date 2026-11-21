/**
 * Explicit Node/Bun polling owned by the application Layer Scope.
 */
import {
  Clock,
  Duration,
  Effect,
  FiberSet,
  Layer,
  Match,
  Random,
  Schema,
  Scope
} from "effect"
import { JobWorker, JobWorkerConfigurationError, JobWorkerNotReady } from "./JobWorker.js"
import { durationMillis } from "./internal/policy/Retry.js"
import { EpochMillis } from "./JobPolicy.js"
import { observe } from "./JobTelemetry.js"
import { WorkerCapability } from "./internal/worker/Capability.js"
import { drainWithOptions } from "./internal/worker/Drain.js"
import { runFor, DrainLimitsSchema } from "./internal/worker/GroupWorker.js"
import type { DrainLimits } from "./JobWorker.js"
import type { JobQueue } from "./JobQueue.js"
import type { QueueRun } from "./internal/worker/QueueRun.js"

/**
 * Polling configuration. idlePoll defaults to one second and must be positive.
 * Idle/backoff sleeps include jitter. shutdownGrace defaults to 30 seconds
 * and accepts zero through five minutes. Both use whole milliseconds.
 * recoveryRetryIntervalMillis defaults to 30 seconds and must be a positive
 * integer. It enables recovery on the next eligible round during claim backoff.
 *
 * @category models
 */
export interface Options extends DrainLimits {
  readonly recoveryRetryIntervalMillis?: number
  readonly idlePoll?: Duration.Duration
  readonly shutdownGrace?: Duration.Duration
}
const OptionsSchema = Schema.Struct({
  ...DrainLimitsSchema.fields,
  recoveryRetryIntervalMillis: EpochMillis.pipe(Schema.optionalKey),
  idlePoll: Schema.Duration.pipe(Schema.optionalKey),
  shutdownGrace: Schema.Duration.pipe(Schema.optionalKey)
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
  recoveryRetryIntervalMillis: number,
  executions: FiberSet.FiberSet<void, never>
) =>
  Effect.gen(function* () {
    let failures = 0
    let recoverNormally = true
    let retryRecovery = false
    let lastRecovery = 0n
    const recoveryInterval = BigInt(recoveryRetryIntervalMillis) * 1_000_000n
    yield* Effect.whileLoop({
      while: () => true,
      body: () =>
        Effect.gen(function* () {
          const now = yield* Clock.monotonicTimeNanos
          const recover =
            recoverNormally || retryRecovery || now - lastRecovery >= recoveryInterval
          if (recover) {
            lastRecovery = now
          }
          const result = yield* drainWithOptions(consumer, { recover, executions }).pipe(
            observe("polling", "dispatch")
          )
          // Retry a failed recovery after backoff without resetting a claim failure streak.
          retryRecovery = result._tag === "Backoff" && result.phase === "recovery"
          yield* Match.value(result).pipe(
            Match.tag("Backoff", (result) =>
              Effect.gen(function* () {
                if (
                  result.claimed > 0 ||
                  (recoverNormally && result.phase !== "recovery")
                ) {
                  failures = 0
                }
                yield* sleepWithJitter(
                  backoffMillis[Math.min(failures, backoffMillis.length - 1)] ?? 30_000
                ).pipe(observe("backoff", "maintenance"))
                failures = Math.min(failures + 1, backoffMillis.length - 1)
                if (result.phase !== "recovery") {
                  recoverNormally = false
                }
              })
            ),
            Match.tag("Idle", () =>
              Effect.gen(function* () {
                failures = 0
                recoverNormally = true
                yield* sleepWithJitter(idlePollMillis)
              })
            ),
            Match.tag("MoreWork", () =>
              Effect.gen(function* () {
                failures = 0
                recoverNormally = true
                yield* Effect.yieldNow
              })
            ),
            Match.exhaustive
          )
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
      const idlePollMillis =
        decoded.idlePoll === undefined ? 1_000 : durationMillis(decoded.idlePoll)
      if (!Schema.is(EpochMillis)(idlePollMillis)) {
        return yield* new JobWorkerConfigurationError({ field: "idlePoll" })
      }
      const shutdownGraceMillis =
        decoded.shutdownGrace === undefined
          ? 30_000
          : durationMillis(decoded.shutdownGrace)
      if (
        !Number.isInteger(shutdownGraceMillis) ||
        shutdownGraceMillis < 0 ||
        shutdownGraceMillis > 300_000
      ) {
        return yield* new JobWorkerConfigurationError({ field: "polling" })
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
            if (shutdownGraceMillis > 0) {
              // Only the race children are interruptible. Restoring interruptibility
              // on the finalizer itself would re-observe the shutdown interruption
              // and skip grace when the application is interrupted.
              yield* Effect.raceFirst(
                FiberSet.awaitEmpty(owned.executions).pipe(Effect.interruptible),
                Effect.sleep(shutdownGraceMillis).pipe(Effect.interruptible)
              )
            }
          }).pipe(Effect.ensuring(Scope.close(owned.scope, exit)))
      )
      for (const consumer of consumers) {
        yield* FiberSet.run(
          lifetime.admissions,
          loop(
            consumer,
            idlePollMillis,
            decoded.recoveryRetryIntervalMillis ?? 30_000,
            lifetime.executions
          )
        )
      }
    })
  )
