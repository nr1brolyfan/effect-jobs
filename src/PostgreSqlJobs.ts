import { Context, Effect, Layer, Schema } from "effect"
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

export interface Options extends TableOptions {
  readonly operationResponseBudgetMillis: number
}
export interface Backend {
  readonly ready: Effect.Effect<void, PostgreSqlError>
  readonly tables: Tables
  readonly store: JobStoreService<PostgreSqlError>
  /** Optional, separately selected. Never installed implicitly or run by imports. */
  readonly cleanup: JobCleanupService<PostgreSqlError>
  readonly joinTransaction: <A, E, R>(
    handle: unknown,
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
  readonly withTransaction: <A, E, R>(
    body: (tx: JobsTransaction<PostgreSqlError>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
}
export class PostgreSqlJobs extends Context.Service<PostgreSqlJobs, Backend>()(
  "effect-jobs/PostgreSqlJobs"
) {}

/** Pure construction: no borrow, transaction, readiness SQL, DDL, worker or pool shutdown. */
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
    return PostgreSqlJobs.of({
      ready: ready(adapter, jobs, payloads),
      tables: mapping,
      store: makeStore(adapter, jobs, payloads, budget),
      cleanup: makeCleanup(adapter, jobs),
      joinTransaction,
      withTransaction: (body) =>
        adapter.withTransaction((handle) => joinTransaction(handle, body))
    })
  })
export const layerNoDeps = (options: Options) =>
  Layer.effect(PostgreSqlJobs, make(options))
