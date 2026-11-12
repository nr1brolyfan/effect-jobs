import { makeHealth } from "./internal/Health.js"
/**
 * PostgreSQL storage and transaction bridge using application-owned connections.
 */
import { JobOperators, type JobOperatorsService } from "../JobOperators.js"
import { makeOperators } from "./internal/Operators.js"
import { PostgreSqlFailure, PostgreSqlInvalidHandle } from "./PostgreSqlTransaction.js"
import { Cause, Context, Effect, Layer } from "effect"
import { JobPersistenceError, JobEnqueue, type JobEnqueueService } from "../JobEnqueue.js"
import type { JobsTransaction } from "../JobTransaction.js"
import { PostgreSqlApplication, type PostgreSqlError } from "./PostgreSqlTransaction.js"
import {
  PostgreSqlConfigurationError,
  relations,
  tables,
  type TableOptions,
  type Tables
} from "./PostgreSqlSchema.js"
import type { JobCleanupService, JobStoreService } from "../JobStore.js"
import {
  insertPreparing,
  JobsTransactionTypeId,
  withJoinedTransaction
} from "../internal/JobTransaction.js"
import { insertOrCompare } from "./internal/Producer.js"
import { makeCleanup, makeStore } from "./internal/Store.js"
import { ready } from "./internal/Readiness.js"
import * as Storage from "../JobStorage.js"
import * as Schedule from "../JobSchedule.js"
import { makeSchedule } from "./internal/Schedule.js"

const persistenceError = (error: PostgreSqlError): JobPersistenceError =>
  new JobPersistenceError({
    reason:
      error._tag === "PostgreSqlFailure"
        ? "storage-failure"
        : error.reason === "active-transaction"
          ? "active-transaction"
          : error.reason === "inactive-handle"
            ? "transaction-required"
            : "unqualified-storage",
    commitKnowledge:
      error._tag === "PostgreSqlFailure" ? error.commitKnowledge : "NotCommitted"
  })

/** Translate only native persistence Fail reasons; preserve all other Cause reasons. */
const neutralProducer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<Exclude<E, PostgreSqlError> | JobPersistenceError>(
          cause.reasons.map((reason) => {
            if (
              Cause.isFailReason(reason) &&
              (reason.error instanceof PostgreSqlFailure ||
                reason.error instanceof PostgreSqlInvalidHandle)
            ) {
              return Cause.makeFailReason(persistenceError(reason.error))
            }
            // The two native Fail variants were exhausted above. Defects/interruption
            // are retained by identity, and arbitrary application errors stay generic.
            return reason as Cause.Reason<Exclude<E, PostgreSqlError>>
          })
        )
      )
    )
  )

/** Ambient production inside a bridge is bound to its validated callback invocation. */
const transactionProducer = (
  tx: JobsTransaction<PostgreSqlError>
): JobEnqueueService => ({
  enqueue: (prepared) => insertPreparing(tx, prepared).pipe(neutralProducer),
  enqueueStandalone: () =>
    tx[JobsTransactionTypeId].assertActive.pipe(
      Effect.andThen(
        Effect.fail(
          new JobPersistenceError({
            reason: "active-transaction",
            commitKnowledge: "NotCommitted"
          })
        )
      )
    )
})

const neutralOperators = (
  operators: JobOperatorsService<PostgreSqlError>
): JobOperatorsService<JobPersistenceError> => ({
  retryNow: (expected) =>
    operators
      .retryNow(expected)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.map(cause, (error) =>
              error instanceof PostgreSqlFailure ||
              error instanceof PostgreSqlInvalidHandle
                ? persistenceError(error)
                : error
            )
          )
        )
      ),
  cancel: (expected) =>
    operators
      .cancel(expected)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.map(cause, (error) =>
              error instanceof PostgreSqlFailure ||
              error instanceof PostgreSqlInvalidHandle
                ? persistenceError(error)
                : error
            )
          )
        )
      ),
  redrive: (definition, request) =>
    operators
      .redrive(definition, request)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.map(cause, (error) =>
              error instanceof PostgreSqlFailure ||
              error instanceof PostgreSqlInvalidHandle
                ? persistenceError(error)
                : error
            )
          )
        )
      ),
  correctedRedrive: (definition, request) =>
    operators
      .correctedRedrive(definition, request)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.map(cause, (error) =>
              error instanceof PostgreSqlFailure ||
              error instanceof PostgreSqlInvalidHandle
                ? persistenceError(error)
                : error
            )
          )
        )
      )
})

/**
 * Storage mapping and its single positive operation response budget.
 *
 * @category models
 */
export interface Options extends TableOptions {
  /** Positive integer reserve used by claim admission and worker execution. */
  readonly operationResponseBudgetMillis: number
}
/**
 * Configured persistence and callback bridge. Readiness, workers and cleanup are
 * explicit; migrations and pool lifetime remain application-owned.
 *
 * @category models
 */
export interface Service {
  /** Portable execution service captured with this jobs's admission budget. */
  readonly storage: Storage.JobStorageService
  /** Shared execution reserve, resolved once with this storage configuration. */
  readonly operationResponseBudgetMillis: number
  /** Explicit bounded schema/index introspection; never creates or migrates storage. */
  readonly ready: Effect.Effect<void, PostgreSqlError>
  readonly tables: Tables
  /** Configured ambient/standalone producer service. */
  readonly producer: JobEnqueueService
  readonly operators: JobOperatorsService<PostgreSqlError>
  /** Durable worker port; owned operations require acknowledged commit and reject ambient transactions. */
  readonly store: JobStoreService<PostgreSqlError>
  /** Optional, separately selected. Never installed implicitly or run by imports. */
  readonly cleanup: JobCleanupService<PostgreSqlError>
  /** Opt-in read-only bounded health sample; app selects ONE reporter per queue/storage. */
  readonly health: ReturnType<typeof makeHealth>
  /** Read-only queue wake hints; this raw port retains native PostgreSQL errors. */
  readonly schedule: Schedule.Reader<PostgreSqlError>
  /** Joins the adapter-registered exact active source/connection and supplies an
   * invocation-bound JobEnqueue service. No BEGIN/savepoint,
   * independent commit or replay. Sequence enqueue inside this callback; its capability
   * closes on exit and success remains provisional until outer commit.
   *
   * @example
   * ```ts
   * import { Effect, type Schema } from "effect"
   * import type { Service } from "effect-jobs/PostgreSqlJobs"
   * import type { JobDefinition } from "effect-jobs/Job"
   * import type { JobQueue } from "effect-jobs/JobQueue"
   * import * as Producer from "effect-jobs/JobProducer"
   *
   * // Call inside the application's owning transaction with its registered handle.
   * const enqueueInside = <S extends Schema.Top>(
   *   jobs: Service, handle: unknown,
   *   definition: JobDefinition<S>, queue: JobQueue,
   *   operationId: string, payload: S["Type"]
   * ) => Effect.gen(function* () {
   *   const producer = yield* Producer.make("invoice.issue").pipe(
   *     Producer.withSlot("generate", definition, { queue })
   *   )
   *   return yield* jobs.joinTransaction(handle, (tx) => producer.enqueueInTransaction(tx, {
   *     slot: "generate", operationId, payload
   *   }))
   * })
   * ```
   */
  readonly joinTransaction: <A, E, R>(
    handle: unknown,
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, Exclude<R, JobEnqueue>>
  /** Delegates join-or-establish to the application manager, then supplies the scoped
   * enqueue capability. Does not reconcile or replay unknown application commits. */
  readonly withTransaction: <A, E, R>(
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, Exclude<R, JobEnqueue | JobOperators>>
}
/**
 * Context service produced by make or layerNoDeps; construction starts no SQL.
 *
 * @category services
 */
export class PostgreSqlJobs extends Context.Service<PostgreSqlJobs, Service>()(
  "effect-jobs/PostgreSqlJobs"
) {}

/**
 * Captures PostgreSqlApplication and validates mapping/budget. Fails with
 * PostgreSqlConfigurationError; performs no borrowing, readiness SQL, DDL,
 * worker startup or pool shutdown. Invoke jobs.ready explicitly before use.
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
    const { jobs, payloads } = relations(mapping)
    const joinTransaction: Service["joinTransaction"] = (handle, body) =>
      adapter.validate(handle).pipe(
        Effect.flatMap((query) =>
          withJoinedTransaction(
            (prepared) => insertOrCompare(query, jobs, payloads, prepared, budget),
            (tx) =>
              Effect.suspend(() => body(tx)).pipe(
                Effect.provideService(JobEnqueue, transactionProducer(tx))
              )
          )
        )
      )
    const producer: JobEnqueueService = {
      enqueue: (prepared) =>
        Effect.gen(function* () {
          if (adapter.ambient === undefined) {
            return yield* new JobPersistenceError({
              reason: "unqualified-storage",
              commitKnowledge: "NotCommitted"
            })
          }
          const query = yield* adapter.ambient.pipe(
            Effect.catchCause((cause) =>
              Effect.failCause(Cause.map(cause, persistenceError))
            )
          )
          const value = yield* prepared
          return yield* insertOrCompare(query, jobs, payloads, value, budget).pipe(
            neutralProducer
          )
        }),
      enqueueStandalone: (prepared) =>
        adapter
          .ownedTransaction((query) =>
            Effect.gen(function* () {
              const value = yield* prepared
              return yield* insertOrCompare(query, jobs, payloads, value, budget)
            })
          )
          .pipe(neutralProducer)
    }
    const store = makeStore(adapter, jobs, payloads, budget)
    const storage = yield* Storage.make({
      store,
      operationResponseBudgetMillis: budget
    }).pipe(
      Effect.mapError((error) => new PostgreSqlConfigurationError({ field: error.field }))
    )
    const operators = makeOperators(adapter, jobs, payloads, budget)
    const neutral = neutralOperators(operators)
    return PostgreSqlJobs.of({
      operationResponseBudgetMillis: budget,
      storage,
      operators,
      producer,
      ready: ready(adapter, jobs, payloads),
      tables: mapping,
      store,
      cleanup: makeCleanup(adapter, jobs),
      health: makeHealth(adapter, jobs),
      schedule: makeSchedule(adapter, jobs),
      joinTransaction,
      withTransaction: (body) =>
        adapter.withTransaction((handle) =>
          adapter.ambient === undefined
            ? joinTransaction(handle, (tx) =>
                body(tx).pipe(
                  Effect.provide(
                    Context.make(JobEnqueue, transactionProducer(tx)).pipe(
                      Context.add(JobOperators, neutral)
                    )
                  )
                )
              )
            : adapter.ambient.pipe(
                Effect.flatMap((query) =>
                  withJoinedTransaction(
                    (prepared) =>
                      insertOrCompare(query, jobs, payloads, prepared, budget),
                    (tx) =>
                      body(tx).pipe(
                        Effect.provide(
                          Context.make(JobEnqueue, transactionProducer(tx)).pipe(
                            Context.add(JobOperators, neutral)
                          )
                        )
                      )
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
      Effect.map((jobs) =>
        Layer.mergeAll(
          Layer.succeed(PostgreSqlJobs, jobs),
          Layer.succeed(JobEnqueue, jobs.producer),
          Layer.succeed(JobOperators, neutralOperators(jobs.operators)),
          Layer.succeed(Storage.JobStorage, jobs.storage),
          Schedule.layer(jobs.schedule)
        )
      )
    )
  )
