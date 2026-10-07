/**
 * PostgreSQL storage and transaction bridge using application-owned connections.
 */
import { JobIntegrityConflict } from "./JobContract.js"
import { PostgreSqlFailure, PostgreSqlInvalidHandle } from "./PostgreSqlTransaction.js"
import { Context, Effect, Layer, Schema } from "effect"
import { JobBackendError, JobEnqueue, type JobEnqueueService } from "./JobEnqueue.js"
import { EpochMillis } from "./JobPolicy.js"
import type { JobsTransaction } from "./JobTransaction.js"
import { PostgreSqlApplication, type PostgreSqlError } from "./PostgreSqlTransaction.js"
import {
  PostgreSqlConfigurationError,
  relations,
  tables,
  type TableOptions,
  type Tables
} from "./PostgreSqlSchema.js"
import type { JobCleanupService, JobStoreService } from "./JobStore.js"
import { withJoinedTransaction } from "./internal/JobTransaction.js"
import { insertOrCompare } from "./internal/postgresql/Producer.js"
import { makeCleanup, makeStore } from "./internal/postgresql/Store.js"
import { ready } from "./internal/postgresql/Readiness.js"

/**
 * Storage mapping and positive operation response budget; match the worker budget.
 *
 * @category models
 */
export interface Options extends TableOptions {
  /** Positive integer reserve matching Worker options, within the remaining stored lease. */
  readonly operationResponseBudgetMillis: number
}
/**
 * Configured persistence and callback bridge. Readiness, workers and cleanup are
 * explicit; migrations and pool lifetime remain application-owned.
 *
 * @category models
 */
export interface Backend {
  /** Explicit bounded schema/index introspection; never creates or migrates storage. */
  readonly ready: Effect.Effect<void, PostgreSqlError>
  readonly tables: Tables
  /** Configured ambient/standalone producer service. */
  readonly producer: JobEnqueueService
  /** Durable worker port; owned operations require acknowledged commit and reject ambient transactions. */
  readonly store: JobStoreService<PostgreSqlError>
  /** Optional, separately selected. Never installed implicitly or run by imports. */
  readonly cleanup: JobCleanupService<PostgreSqlError>
  /** Joins the adapter-registered exact active source/connection. No BEGIN/savepoint,
   * independent commit or replay. Sequence enqueue inside this callback; its capability
   * closes on exit and success remains provisional until outer commit.
   *
   * @example
   * ```ts
   * import type { Schema } from "effect"
   * import type { Backend } from "effect-jobs/PostgreSqlJobs"
   * import type { JobDefinition } from "effect-jobs/Job"
   * import type { EnqueueInput } from "effect-jobs/JobContract"
   *
   * // Call inside the application's owning transaction with its registered handle.
   * const enqueueInside = <S extends Schema.Top>(
   *   backend: Backend, handle: unknown,
   *   definition: JobDefinition<S>, input: EnqueueInput<S["Type"]>
   * ) => backend.joinTransaction(handle, (tx) => definition.enqueueInTransaction(tx, input))
   * ```
   */
  readonly joinTransaction: <A, E, R>(
    handle: unknown,
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
  /** Delegates join-or-establish to the application manager, then supplies the scoped
   * enqueue capability. Does not reconcile or replay unknown application commits. */
  readonly withTransaction: <A, E, R>(
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, Exclude<R, JobEnqueue>>
}
/**
 * Context service produced by make or layerNoDeps; construction starts no SQL.
 *
 * @category services
 */
export class PostgreSqlJobs extends Context.Service<PostgreSqlJobs, Backend>()(
  "effect-jobs/PostgreSqlJobs"
) {}

/**
 * Captures PostgreSqlApplication and validates mapping/budget. Fails with
 * PostgreSqlConfigurationError; performs no borrowing, readiness SQL, DDL,
 * worker startup or pool shutdown. Invoke backend.ready explicitly before use.
 *
 * @category constructors
 */
export const make = (options: Options) =>
  Effect.gen(function* () {
    const adapter = yield* PostgreSqlApplication
    const mapping = yield* Effect.try({
      try: () => tables(options),
      catch: (error) => error as PostgreSqlConfigurationError
    })
    const budget = options.operationResponseBudgetMillis
    if (!Schema.is(EpochMillis)(budget) || budget === 0) {
      return yield* new PostgreSqlConfigurationError({
        field: "operationResponseBudgetMillis"
      })
    }
    const { jobs, payloads } = relations(mapping)
    const joinTransaction: Backend["joinTransaction"] = (handle, body) =>
      adapter
        .validate(handle)
        .pipe(
          Effect.flatMap((query) =>
            withJoinedTransaction(
              (prepared) => insertOrCompare(query, jobs, payloads, prepared),
              body
            )
          )
        )
    const backendError = (error: PostgreSqlError): JobBackendError =>
      new JobBackendError({
        reason:
          error._tag === "PostgreSqlFailure"
            ? "storage-failure"
            : error.reason === "active-transaction"
              ? "active-transaction"
              : error.reason === "inactive-handle"
                ? "transaction-required"
                : "unqualified-backend",
        commitKnowledge:
          error._tag === "PostgreSqlFailure" ? error.commitKnowledge : "NotCommitted"
      })
    const producer: JobEnqueueService = {
      enqueue: (prepared) =>
        Effect.gen(function* () {
          if (adapter.ambient === undefined) {
            return yield* new JobBackendError({
              reason: "unqualified-backend",
              commitKnowledge: "NotCommitted"
            })
          }
          const query = yield* adapter.ambient.pipe(Effect.mapError(backendError))
          const value = yield* prepared
          return yield* insertOrCompare(query, jobs, payloads, value).pipe(
            Effect.mapError((error) =>
              error._tag === "JobIntegrityConflict" ? error : backendError(error)
            )
          )
        }),
      enqueueStandalone: (prepared) =>
        adapter
          .ownedTransaction((query) =>
            Effect.gen(function* () {
              const value = yield* prepared
              return yield* insertOrCompare(query, jobs, payloads, value)
            })
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof JobIntegrityConflict ||
              !(
                error instanceof PostgreSqlFailure ||
                error instanceof PostgreSqlInvalidHandle
              )
                ? error
                : backendError(error)
            )
          )
    }
    return PostgreSqlJobs.of({
      producer,
      ready: ready(adapter, jobs, payloads),
      tables: mapping,
      store: makeStore(adapter, jobs, payloads, budget),
      cleanup: makeCleanup(adapter, jobs),
      joinTransaction,
      withTransaction: (body) =>
        adapter.withTransaction((handle) =>
          adapter.ambient === undefined
            ? joinTransaction(handle, (tx) =>
                body(tx).pipe(Effect.provideService(JobEnqueue, producer))
              )
            : adapter.ambient.pipe(
                Effect.flatMap((query) =>
                  withJoinedTransaction(
                    (prepared) => insertOrCompare(query, jobs, payloads, prepared),
                    (tx) => body(tx).pipe(Effect.provideService(JobEnqueue, producer))
                  )
                )
              )
        )
    })
  })
/**
 * Produces PostgreSqlJobs while requiring PostgreSqlApplication. Supply a qualified
 * application adapter separately; neither the driver nor a transaction engine is bundled.
 *
 * @category layers
 */
export const layerNoDeps = (options: Options) =>
  Layer.unwrap(
    make(options).pipe(
      Effect.map((backend) =>
        Layer.merge(
          Layer.succeed(PostgreSqlJobs, backend),
          Layer.succeed(JobEnqueue, backend.producer)
        )
      )
    )
  )
