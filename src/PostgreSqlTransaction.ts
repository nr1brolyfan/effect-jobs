import { Context, Data } from "effect"
import type { Effect } from "effect"

/** Sanitized adapter failure. Never attach SQL, parameters or provider Causes. */
export class PostgreSqlFailure extends Data.TaggedError("PostgreSqlFailure")<{
  readonly commitKnowledge: "NotCommitted" | "Unknown"
}> {}
export class PostgreSqlInvalidHandle extends Data.TaggedError("PostgreSqlInvalidHandle")<{
  readonly reason:
    | "foreign-source"
    | "unqualified-handle"
    | "inactive-handle"
    | "active-transaction"
}> {}
export type PostgreSqlError = PostgreSqlFailure | PostgreSqlInvalidHandle

/** Only the owning adapter supplies this exact-connection query capability. */
export interface TransactionQuery {
  readonly query: (
    text: string,
    values?: ReadonlyArray<unknown>
  ) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, PostgreSqlError>
}

/**
 * Explicit trusted extension contract, NOT a structural SQL-client constructor.
 * validate must prove private registration, source identity and active invocation.
 * withTransaction delegates join-or-establish to the application's manager.
 * ownedTransaction must reject ambient transactions, commit before returning, and
 * report uncertain COMMIT/response delivery as Unknown. No automatic replay.
 * All acquisition/query/control/release paths must have finite application bounds.
 * The application owns rollback, pool lifetime, readiness and migrations.
 */
export interface ApplicationAdapter {
  readonly validate: (handle: unknown) => Effect.Effect<TransactionQuery, PostgreSqlError>
  readonly withTransaction: <A, E, R>(
    body: (handle: unknown) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
  readonly ownedTransaction: <A, E, R>(
    body: (query: TransactionQuery) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
}
export class PostgreSqlApplication extends Context.Service<
  PostgreSqlApplication,
  ApplicationAdapter
>()("effect-jobs/PostgreSqlApplication") {}
