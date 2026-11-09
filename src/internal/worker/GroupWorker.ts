/** Group-to-engine construction and bounded drain. */
import { Context, Effect, Option, Schema } from "effect"
import type { JobApi, Groups, HandlerServices } from "../../JobApi.js"
import { JobStorage } from "../../JobStorage.js"
import type { JobQueue } from "../../JobQueue.js"
import { QueueName } from "../../JobIdentity.js"
import type { JobHandler } from "./Handler.js"
import { JobWorker } from "../../JobWorker.js"
import type { QueueRun } from "./QueueRun.js"
import { JobWorkerConfigurationError, WorkerCapability } from "./Capability.js"
import { makeWithHandlers } from "./Runtime.js"
import { drainWithOptions } from "./Drain.js"

export interface QueueOptions {
  readonly queue: JobQueue
  readonly concurrency?: number
}

export interface Options {
  readonly queues: ReadonlyArray<QueueOptions>
}

export interface DrainLimits {
  readonly maxJobs?: number
  readonly recoveryLimit?: number
}

const Concurrency = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 64 }))
)
const Limit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
)
export const DrainLimitsSchema = Schema.Struct({
  maxJobs: Limit.pipe(Schema.optionalKey),
  recoveryLimit: Limit.pipe(Schema.optionalKey)
})

/**
 * Resolves complete group handlers and fixes all queue semaphores at acquisition.
 * Uses the existing claim/reconciliation/finalization engine, not a second runtime.
 */
export const make = <A extends JobApi<string, Groups>>(api: A, options: Options) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<HandlerServices<A["groups"]>>()
    const groups = yield* Effect.forEach(Object.values(api.groups), (group) =>
      Effect.gen(function* () {
        const installed = Context.getOption(services, group.handlers)
        if (Option.isNone(installed)) {
          return yield* new JobWorkerConfigurationError({ field: "catalog" })
        }
        return { group, handlers: installed.value }
      })
    )
    if (groups.length === 0) {
      return yield* new JobWorkerConfigurationError({ field: "catalog" })
    }
    const storage = yield* JobStorage
    const queues = options.queues.map((entry) =>
      Object.freeze({
        queue: Object.freeze({ ...entry.queue }),
        concurrency: entry.concurrency ?? 1
      })
    )
    if (
      queues.length === 0 ||
      queues.some(
        (entry) =>
          !Schema.is(QueueName)(entry.queue.name) ||
          !Schema.is(Concurrency)(entry.concurrency)
      ) ||
      new Set(queues.map((entry) => entry.queue.name)).size !== queues.length
    ) {
      return yield* new JobWorkerConfigurationError({ field: "queues" })
    }
    const installed: ReadonlyArray<JobHandler> = queues.flatMap((entry) =>
      groups.flatMap((bound) =>
        Object.entries(bound.group.definitions).map((definition) =>
          Object.freeze({
            catalog: Object.freeze({
              queue: entry.queue.name,
              kind: definition[1].kind,
              version: definition[1].version
            }),
            execute: bound.handlers[definition[0]]!
          })
        )
      )
    )
    const catalog = installed.map((entry) => ({ catalog: entry.catalog }))
    const worker = yield* makeWithHandlers(
      storage.store,
      { catalog, operationResponseBudgetMillis: storage.operationResponseBudgetMillis },
      {
        find: (identity) =>
          installed.find(
            (entry) =>
              entry.catalog.queue === identity.queue &&
              entry.catalog.kind === identity.kind &&
              entry.catalog.version === identity.version
          )
      }
    )
    // Initialize before exposing the worker. Concurrent drains cannot choose a
    // different concurrency through whichever call happens to execute first.
    for (const entry of queues) {
      yield* worker[WorkerCapability].permits({
        queue: entry.queue,
        localConcurrency: entry.concurrency
      })
    }
    return Object.freeze({
      ...worker,
      drain: (queue: JobQueue, limits?: DrainLimits) =>
        drain(queue, limits).pipe(Effect.provideService(JobWorker, worker))
    })
  })

/** Uses concurrency fixed at construction; callers supply only finite run limits. */
export const runFor = Effect.fnUntraced(function* (
  queue: JobQueue,
  limits: DrainLimits = {}
) {
  const decoded = yield* Schema.decodeEffect(DrainLimitsSchema)(limits, {
    onExcessProperty: "error"
  }).pipe(Effect.mapError(() => new JobWorkerConfigurationError({ field: "drain" })))
  const worker = yield* JobWorker
  const concurrency = worker[WorkerCapability].concurrency(queue.name)
  if (concurrency === undefined) {
    return yield* new JobWorkerConfigurationError({ field: "queues" })
  }
  const run: QueueRun = Object.freeze({
    queue: Object.freeze({ ...queue }),
    localConcurrency: concurrency,
    claimLimitPerRun: decoded.maxJobs ?? 20,
    recoveryLimitPerRun: decoded.recoveryLimit ?? 20
  })
  return run
})

export const drain = Effect.fnUntraced(function* (
  queue: JobQueue,
  limits: DrainLimits = {}
) {
  const consumer = yield* runFor(queue, limits)
  return yield* drainWithOptions(consumer)
})
