/** Application-owned pg integration for the explicit production extension contract. */
import { Effect, Option } from "effect"
import {
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../src/PostgreSqlTransaction.js"
import * as App from "../qualification/d6-pg/ApplicationTransactions.js"

const sanitize = <A, E, R>(
  effect: Effect.Effect<A, E | App.PgFailure | App.InvalidHandle, R>
): Effect.Effect<A, E | PostgreSqlError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof App.PgFailure
        ? new PostgreSqlFailure({ commitKnowledge: error.commitKnowledge })
        : error instanceof App.InvalidHandle
          ? new PostgreSqlInvalidHandle({ reason: error.reason })
          : error
    )
  )
export interface FixtureAdapter extends ApplicationAdapter {
  readonly applicationTransaction: <A, E, R>(
    body: (handle: App.Handle) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlFailure | PostgreSqlInvalidHandle, R>
}
export const make = (
  source: App.Source,
  fault?: () => App.CommitFault
): FixtureAdapter => {
  const validate = (handle: unknown) =>
    App.validate(source, handle as App.Handle).pipe(
      (effect) => sanitize<void, never, never>(effect),
      Effect.map((): TransactionQuery => ({
        query: (text, values) =>
          sanitize<ReadonlyArray<Record<string, unknown>>, never, never>(
            (handle as App.Handle).query(text, values)
          )
      }))
    )
  return {
    validate,
    applicationTransaction: <A, E, R>(
      body: (handle: App.Handle) => Effect.Effect<A, E, R>
    ) => sanitize<A, E, R>(App.transaction(source, body)),
    withTransaction: <A, E, R>(body: (handle: unknown) => Effect.Effect<A, E, R>) =>
      sanitize<A, E, R>(App.withTransaction(source, body)),
    ownedTransaction: <A, E, R>(
      body: (query: TransactionQuery) => Effect.Effect<A, E, R>
    ) =>
      App.activeHandle.pipe(
        Effect.flatMap((active) =>
          Option.isSome(active)
            ? Effect.fail(new PostgreSqlInvalidHandle({ reason: "active-transaction" }))
            : sanitize<A, E | PostgreSqlError, R>(
                App.transaction(
                  source,
                  (handle) => validate(handle).pipe(Effect.flatMap(body)),
                  fault?.()
                )
              )
        )
      )
  }
}
