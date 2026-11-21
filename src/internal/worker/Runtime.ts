/**
 * Constructs inert workers; finite drains and scoped polling start execution explicitly.
 */
import { Cause, Effect, Schema, Semaphore } from "effect"
import { JobAddress } from "../../JobIdentity.js"
import { EpochMillis } from "../../JobPolicy.js"
import { observe } from "../../JobTelemetry.js"
import { JobOwnership } from "../../JobLifecycle.js"
import { addressKey, type HandlerLookup } from "./Handler.js"
import { JobPolicyIncompatible } from "../../JobContract.js"
import {
  DispatchResult,
  JobWorkerConfigurationError,
  JobWorkerNotReady,
  JobWorkerUnavailable,
  WorkerCapability
} from "./Capability.js"
import { executionFor } from "./Execution.js"
import type { ClaimedJob, JobStoreService } from "../../JobStore.js"
import type { RuntimeCapability } from "./Capability.js"

export interface RuntimeOptions {
  readonly catalog: ReadonlyArray<{ readonly catalog: JobAddress }>
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
 * Captures store requirements R and validates the resolved catalog/budget.
 * Fails with JobWorkerConfigurationError; creates no running worker or pool.
 * Every catalog entry needs an installed handler before drain or polling is ready.
 *
 * @category constructors
 */
export const makeWithHandlers = <E, R>(
  store: JobStoreService<E, R>,
  options: RuntimeOptions,
  handlers: HandlerLookup
) =>
  Effect.gen(function* () {
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
        name: entry.catalog.name,
        version: entry.catalog.version
      })
    )
    const keys = catalogs.map(addressKey)
    if (
      catalogs.length === 0 ||
      !catalogs.every(Schema.is(JobAddress)) ||
      new Set(keys).size !== keys.length
    ) {
      return yield* new JobWorkerConfigurationError({ field: "catalog" })
    }
    if (
      handlers.immutable &&
      !catalogs.every((entry) => typeof handlers.find(entry)?.execute === "function")
    ) {
      return yield* new JobWorkerConfigurationError({ field: "catalog" })
    }
    const byQueue = new Map<string, Array<JobAddress>>()
    for (const entry of catalogs) {
      const supported = byQueue.get(entry.queue)
      if (supported === undefined) {
        byQueue.set(entry.queue, [entry])
      } else {
        supported.push(entry)
      }
    }
    for (const supported of byQueue.values()) {
      Object.freeze(supported)
    }
    const supportedCatalog = (queue: string) =>
      Effect.suspend(() => {
        const supported = byQueue.get(queue)
        return supported !== undefined &&
          (handlers.immutable ||
            catalogs.every((entry) => handlers.find(entry) !== undefined))
          ? Effect.succeed(supported)
          : Effect.fail(new JobWorkerNotReady())
      })
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
      recoverExpired: (queue, limit) =>
        Effect.suspend(() => store.recoverExpired(queue, limit)).pipe(
          Effect.provide(services)
        )
    }
    const permits = new Map<
      string,
      { readonly concurrency: number; readonly semaphore: Semaphore.Semaphore }
    >()
    const ready: RuntimeCapability["ready"] = (queue) =>
      supportedCatalog(queue).pipe(Effect.asVoid)
    const release = (ownership: JobOwnership) =>
      bound
        .release(ownership, "BeforeExecution")
        .pipe(
          Effect.interruptible,
          Effect.timeout(budget),
          observe("release", "dispatch"),
          Effect.ignore
        )
    const started = (
      claim: ClaimedJob,
      token: string,
      supported: ReadonlyArray<JobAddress>
    ) => {
      if (
        !Schema.is(JobOwnership)(claim.ownership) ||
        claim.ownership.leaseToken !== token
      ) {
        return DispatchResult.Unresolved()
      }
      let phase: "BeforeExecution" | "Executing" | "Released" = "BeforeExecution"
      return DispatchResult.Started({
        execution: Effect.suspend(() => {
          if (phase !== "BeforeExecution") {
            return Effect.void
          }
          phase = "Executing"
          return executionFor(bound, claim, handlers.find, supported, budget)
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
      concurrency: (queue) => permits.get(queue)?.concurrency,
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
          const supported = yield* supportedCatalog(queue)
          // Allocate when the Effect runs, not when it is constructed/reused.
          const token = yield* Effect.sync(() => globalThis.crypto.randomUUID())
          const result = yield* bound
            .claim({
              queue,
              supportedCatalog: supported,
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
            return DispatchResult.Empty()
          }
          if (result._tag === "Claimed") {
            return started(result.claim, token, supported)
          }
          const reconciled = yield* bound
            .reconcileClaim(token)
            .pipe(Effect.timeout(budget), observe("claim", "reconciliation"))
          if (reconciled._tag === "Owned") {
            return started(reconciled.claim, token, supported)
          }
          if (reconciled._tag === "InsufficientLease") {
            if (
              !Schema.is(JobOwnership)(reconciled.ownership) ||
              reconciled.ownership.leaseToken !== token
            ) {
              return DispatchResult.Unresolved()
            }
            yield* release(reconciled.ownership)
            // A confirmed release is not proof the queue is empty.
            return DispatchResult.Unresolved()
          }
          return DispatchResult.Unresolved()
        }).pipe(
          Effect.catchCause(
            (
              cause
            ): Effect.Effect<never, JobPolicyIncompatible | JobWorkerUnavailable> => {
              const [reason] = cause.reasons
              if (
                cause.reasons.length === 1 &&
                reason !== undefined &&
                Cause.isFailReason(reason) &&
                reason.error instanceof JobPolicyIncompatible
              ) {
                return Effect.fail(reason.error)
              }
              return Cause.hasInterrupts(cause)
                ? Effect.interrupt
                : Effect.fail(new JobWorkerUnavailable())
            }
          )
        ),
      recover: (queue, limit) =>
        Effect.gen(function* () {
          let recovered = 0
          for (let remaining = limit; remaining > 0;) {
            const batch = Math.min(500, remaining)
            const count = yield* bound
              .recoverExpired(queue, batch)
              .pipe(Effect.timeout(budget))
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
        }).pipe(observe("recover-expired", "maintenance"), unavailable)
    }
    return Object.freeze({ [WorkerCapability]: capability })
  })
