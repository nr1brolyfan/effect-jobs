/** Group-to-engine construction and bounded drain. */
import { Effect, Schema } from "effect"
import type { JobGroup, Definitions } from "../../JobGroup.js"
import type { JobStoreService } from "../../JobStore.js"
import type { JobQueue } from "../../JobQueue.js"
import { QueueName } from "../../JobIdentity.js"
import type { JobHandler } from "./Handler.js"
import { JobWorker } from "../../JobWorker.js"
import * as Consumer from "../../JobConsumer.js"
import { JobWorkerConfigurationError, WorkerCapability } from "./Capability.js"
import { makeWithHandlers } from "./Runtime.js"
import { drainWithOptions } from "./Drain.js"

/** One configured store owns the budget; group/queue options do not duplicate it. */
export interface Storage<E, R> {
  readonly store: JobStoreService<E, R>
  readonly operationResponseBudgetMillis: number
}

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
export const make = <Name extends string, D extends Definitions, E, R>(
  group: JobGroup<Name, D>,
  storage: Storage<E, R>,
  options: Options
) =>
  Effect.gen(function* () {
    const handlers = yield* group.handlers
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
    const definitions = Object.entries(group.definitions)
    const catalog = queues.flatMap((entry) =>
      definitions.map((definition) => ({
        catalog: Object.freeze({
          queue: entry.queue.name,
          kind: definition[1].kind,
          version: definition[1].version
        })
      }))
    )
    const installed: ReadonlyArray<JobHandler> = catalog.map((entry) => {
      const definition = definitions.find(
        (candidate) =>
          candidate[1].kind === entry.catalog.kind &&
          candidate[1].version === entry.catalog.version
      )!
      return Object.freeze({ catalog: entry.catalog, execute: handlers[definition[0]]! })
    })
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
        localConcurrency: entry.concurrency,
        claimLimitPerRun: 1,
        recoveryLimitPerRun: 1
      })
    }
    return Object.freeze({
      ...worker,
      drain: (queue: JobQueue, limits?: DrainLimits) =>
        drain(queue, limits).pipe(Effect.provideService(JobWorker, worker))
    })
  })

/** Uses concurrency fixed at construction; callers supply only finite run limits. */
export const consumerFor = Effect.fnUntraced(function* (
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
  return yield* Consumer.make(queue, {
    localConcurrency: concurrency,
    claimLimitPerRun: decoded.maxJobs ?? 20,
    recoveryLimitPerRun: decoded.recoveryLimit ?? 20
  }).pipe(Effect.mapError(() => new JobWorkerConfigurationError({ field: "drain" })))
})

export const drain = Effect.fnUntraced(function* (
  queue: JobQueue,
  limits: DrainLimits = {}
) {
  const consumer = yield* consumerFor(queue, limits)
  return yield* drainWithOptions(consumer)
})
