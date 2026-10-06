/**
 * Constructs inert workers; finite drains and scoped polling start execution explicitly.
 */
import { Cause, Context, Effect, Layer, Schema, Semaphore } from "effect"
import { CatalogIdentity } from "./JobIdentity.js"
import { EpochMillis } from "./JobPolicy.js"
import { JobRegistry } from "./JobRegistry.js"
import { observe } from "./JobTelemetry.js"
import { JobOwnership } from "./JobLifecycle.js"
import {
  DispatchResults,
  JobWorkerConfigurationError,
  JobWorkerNotReady,
  JobWorkerUnavailable,
  WorkerCapability
} from "./internal/worker/Capability.js"
import { executionFor } from "./internal/worker/Execution.js"
import type { CatalogEntry } from "./JobRegistry.js"
import type { ClaimedJob, JobStoreService } from "./JobStore.js"
import type { RuntimeCapability } from "./internal/worker/Capability.js"

/** Configuration validation, missing handler readiness, and sanitized store-operation failures. */
export {
  /** Invalid catalog, consumer, polling interval or response budget. */
  JobWorkerConfigurationError,
  /** Required catalog handlers or requested queue are absent. */
  JobWorkerNotReady,
  /** Store operation failed; provider Causes are not exposed. */
  JobWorkerUnavailable
} from "./internal/worker/Capability.js"

/**
 * Sealed runtime service used by drain and polling; no public manual dispatch capability.
 *
 * @category models
 */
export interface JobWorkerService {
  /** Explicit sealed runtime capability, not a process-global WeakMap. */
  readonly [WorkerCapability]: RuntimeCapability
}
/**
 * Context service required by JobWorkerRuntime.drain and scoped polling.
 *
 * @category models
 */
export class JobWorker extends Context.Service<JobWorker, JobWorkerService>()(
  "effect-jobs/JobWorker"
) {}

/**
 * Nonempty unique supported catalog and positive response budget matching the store.
 *
 * @category models
 */
export interface JobWorkerOptions {
  readonly catalog: ReadonlyArray<CatalogEntry>
  /** Must agree with the configured backend's finite response budget. */
  readonly operationResponseBudgetMillis: number
}

const unavailable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.fail(new JobWorkerUnavailable())
    )
  )

/**
 * Captures JobRegistry and store requirements R and validates catalog/budget.
 * Fails with JobWorkerConfigurationError; creates no running worker or pool.
 * Every catalog entry needs an installed handler before drain or polling is ready.
 *
 * @category constructors
 */
export const make = <E, R>(store: JobStoreService<E, R>, options: JobWorkerOptions) =>
  Effect.gen(function* () {
    const registry = yield* JobRegistry
    const services = yield* Effect.context<R>()
    const budget = options.operationResponseBudgetMillis
    if (!Schema.is(EpochMillis)(budget)) {
      return yield* new JobWorkerConfigurationError({
        field: "operationResponseBudgetMillis"
      })
    }
    const catalogs = options.catalog.map((entry) =>
      Object.freeze({
        queue: entry.catalog.queue,
        kind: entry.catalog.kind,
        version: entry.catalog.version
      })
    )
    const keys = catalogs.map(
      (entry) => `${entry.queue}\u0000${entry.kind}\u0000${entry.version}`
    )
    if (
      catalogs.length === 0 ||
      !catalogs.every(Schema.is(CatalogIdentity)) ||
      new Set(keys).size !== keys.length
    ) {
      return yield* new JobWorkerConfigurationError({ field: "catalog" })
    }
    Object.freeze(catalogs)
    const bound: JobStoreService<E> = {
      claim: (input) =>
        Effect.suspend(() => store.claim(input)).pipe(Effect.provide(services)),
      reconcileClaim: (token) =>
        Effect.suspend(() => store.reconcileClaim(token)).pipe(Effect.provide(services)),
      release: (owner, phase) =>
        Effect.suspend(() => store.release(owner, phase)).pipe(Effect.provide(services)),
      finalize: (request) =>
        Effect.suspend(() => store.finalize(request)).pipe(Effect.provide(services)),
      reconcileFinalization: (request) =>
        Effect.suspend(() => store.reconcileFinalization(request)).pipe(
          Effect.provide(services)
        ),
      recoverExpired: (limit) =>
        Effect.suspend(() => store.recoverExpired(limit)).pipe(Effect.provide(services))
    }
    const permits = new Map<
      string,
      { readonly concurrency: number; readonly semaphore: Semaphore.Semaphore }
    >()
    const ready: RuntimeCapability["ready"] = (queue) =>
      Effect.suspend(() =>
        catalogs.some((entry) => entry.queue === queue) &&
        catalogs.every((entry) => registry.find(entry) !== undefined)
          ? Effect.void
          : Effect.fail(new JobWorkerNotReady())
      )
    const release = (ownership: ClaimedJob["ownership"]) =>
      bound
        .release(ownership, "BeforeExecution")
        .pipe(
          Effect.interruptible,
          Effect.timeout(budget),
          observe("release", "dispatch"),
          Effect.ignore
        )
    const started = (claim: ClaimedJob, token: string, queue: string) => {
      if (
        !Schema.is(JobOwnership)(claim.ownership) ||
        claim.ownership.leaseToken !== token
      ) {
        return DispatchResults.Unresolved()
      }
      let phase: "BeforeExecution" | "Executing" | "Released" = "BeforeExecution"
      return DispatchResults.Started({
        execution: Effect.suspend(() => {
          if (phase !== "BeforeExecution") {
            return Effect.void
          }
          phase = "Executing"
          return executionFor(
            bound,
            claim,
            registry.find,
            catalogs.filter((entry) => entry.queue === queue),
            budget
          )
        }),
        release: Effect.suspend(() => {
          if (phase !== "BeforeExecution") {
            return Effect.void
          }
          phase = "Released"
          return release(claim.ownership)
        })
      })
    }
    const capability: RuntimeCapability = {
      ready,
      permits: (consumer) =>
        Effect.suspend(() => {
          const existing = permits.get(consumer.queue.name)
          if (existing !== undefined) {
            if (existing.concurrency !== consumer.localConcurrency) {
              return Effect.fail(new JobWorkerConfigurationError({ field: "consumer" }))
            }
            return Effect.succeed(existing.semaphore)
          }
          // Lookup/create/register is synchronous: no fiber can observe a missing
          // entry while another first drain is creating this queue's semaphore.
          const semaphore = Semaphore.makeUnsafe(consumer.localConcurrency)
          permits.set(consumer.queue.name, {
            concurrency: consumer.localConcurrency,
            semaphore
          })
          return Effect.succeed(semaphore)
        }),
      claim: (queue) =>
        Effect.gen(function* () {
          yield* ready(queue)
          // Allocate when the Effect runs, not when it is constructed/reused.
          const token = yield* Effect.sync(() => globalThis.crypto.randomUUID())
          const result = yield* bound
            .claim({
              queue,
              supportedCatalog: catalogs.filter((entry) => entry.queue === queue),
              leaseToken: token
            })
            .pipe(
              Effect.timeoutOrElse({
                duration: budget,
                orElse: () => Effect.succeed({ _tag: "Unknown" as const })
              }),
              observe("claim", "dispatch")
            )
          if (result._tag === "Empty") {
            return DispatchResults.Empty()
          }
          if (result._tag === "Claimed") {
            return started(result.claim, token, queue)
          }
          const reconciled = yield* bound
            .reconcileClaim(token)
            .pipe(Effect.timeout(budget), observe("claim", "reconciliation"))
          if (reconciled._tag === "Owned") {
            return started(reconciled.claim, token, queue)
          }
          if (reconciled._tag === "InsufficientLease") {
            if (
              !Schema.is(JobOwnership)(reconciled.ownership) ||
              reconciled.ownership.leaseToken !== token
            ) {
              return DispatchResults.Unresolved()
            }
            yield* release(reconciled.ownership)
            // A confirmed release is not proof the queue is empty.
            return DispatchResults.Unresolved()
          }
          return DispatchResults.Unresolved()
        }).pipe(unavailable),
      recover: (limit) =>
        Effect.gen(function* () {
          let recovered = 0
          for (let remaining = limit; remaining > 0;) {
            const batch = Math.min(500, remaining)
            const count = yield* bound
              .recoverExpired(batch)
              .pipe(Effect.timeout(budget), observe("recover-expired", "maintenance"))
            if (!Number.isInteger(count) || count < 0 || count > batch) {
              return yield* new JobWorkerUnavailable()
            }
            recovered += count
            remaining -= batch
            if (count < batch) {
              break
            }
          }
          return recovered
        }).pipe(unavailable)
    }
    return JobWorker.of(Object.freeze({ [WorkerCapability]: capability }))
  })

/**
 * Produces JobWorker, requiring JobRegistry and the store's R services.
 * Construction validates configuration but starts no drain, polling, migration or pool.
 *
 * @category layers
 */
export const layer = <E, R>(store: JobStoreService<E, R>, options: JobWorkerOptions) =>
  Layer.effect(JobWorker, make(store, options))
