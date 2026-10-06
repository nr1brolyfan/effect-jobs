/**
 * Trusted application-adapter contract for exact-source, active PostgreSQL transactions.
 */
import { Context, Data } from "effect"
import type { Effect } from "effect"

/**
 * Sanitized adapter failure. Unknown commit knowledge must stay unknown; never
 * attach SQL, parameters, DSNs or provider Causes, or infer rollback from timeout.
 *
 * @category errors
 */
export class PostgreSqlFailure extends Data.TaggedError("PostgreSqlFailure")<{
  readonly commitKnowledge: "NotCommitted" | "Unknown"
}> {}
/**
 * Typed rejection of foreign, unqualified, inactive or ambient transaction handles.
 *
 * @category errors
 */
export class PostgreSqlInvalidHandle extends Data.TaggedError("PostgreSqlInvalidHandle")<{
  readonly reason:
    | "foreign-source"
    | "unqualified-handle"
    | "inactive-handle"
    | "active-transaction"
}> {}
/**
 * Sanitized persistence failure or rejected transaction handle.
 *
 * @category models
 */
export type PostgreSqlError = PostgreSqlFailure | PostgreSqlInvalidHandle

/**
 * Exact-connection query capability supplied only by the owning qualified adapter.
 * Sequence queries and revalidate invocation lifetime before each query.
 *
 * @category models
 */
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
 * A COMMIT command tag of ROLLBACK is a NotCommitted failure, not success.
 * All acquisition/query/control/release paths must have finite application bounds.
 * The application owns rollback, pool lifetime, readiness and migrations.
 */
export interface ApplicationAdapter {
  /** Proves private registration, exact source/connection and active lifetime; rejects structural impostors. */
  readonly validate: (handle: unknown) => Effect.Effect<TransactionQuery, PostgreSqlError>
  /** Joins a compatible active transaction or delegates establishment to the owning manager. */
  readonly withTransaction: <A, E, R>(
    body: (handle: unknown) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
  /** Rejects ambient transactions; success means durable commit acknowledged, never provisional join success. */
  readonly ownedTransaction: <A, E, R>(
    body: (query: TransactionQuery) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlError, R>
}
/**
 * Context service supplied by the application; no universal pg/Drizzle adapter ships.
 *
 * @category services
 */
export class PostgreSqlApplication extends Context.Service<
  PostgreSqlApplication,
  ApplicationAdapter
>()("effect-jobs/PostgreSqlApplication") {}
