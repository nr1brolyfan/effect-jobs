// Native low-level SQL APIs are intentionally pinned to 4.0.0 by the consumer runner.
// @effect-diagnostics unstableApiUsage:off
// Qualification-only application registrar, never a shipped universal adapter.
import { Cause, Context, Effect, Option } from "effect"
import type { PgClient } from "@effect/sql-pg/PgClient"
import type { Connection } from "effect/sql/SqlConnection"
import type { SqlError } from "effect/sql/SqlError"
import { isSqlError } from "effect/sql/SqlError"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import {
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "effect-jobs/PostgreSqlTransaction"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "effect-jobs/PostgreSqlTransaction"

export interface Handle {
  readonly token: symbol
}
interface Source {
  readonly client: PgClient
}
interface State {
  readonly source: Source
  // Native SQL API is intentionally version-pinned in this isolated probe.
  readonly connection: Connection
  active: boolean
}
const handles = new WeakMap<Handle, State>()
const Current = Context.Reference<Option.Option<Handle>>("drizzle-native/Current", {
  defaultValue: Option.none
})

// Native control failures can enter the defect channel. Replace only provider
// reasons, retaining caller failures/defects and interruption in mixed Causes.
export const sanitizeControls = <A, E, R>(
  effect: Effect.Effect<A, E | SqlError | EffectDrizzleQueryError, R>
): Effect.Effect<A, E | PostgreSqlFailure, R> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<E | PostgreSqlFailure>(
          cause.reasons.flatMap<Cause.Reason<E | PostgreSqlFailure>>((reason) => {
            if (
              Cause.isFailReason(reason) &&
              reason.error instanceof EffectDrizzleQueryError
            ) {
              return Cause.fail(
                new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
              ).reasons
            }
            if (
              (Cause.isFailReason(reason) && isSqlError(reason.error)) ||
              (Cause.isDieReason(reason) && isSqlError(reason.defect))
            ) {
              return Cause.fail(new PostgreSqlFailure({ commitKnowledge: "Unknown" }))
                .reasons
            }
            return [reason as Cause.Reason<E>]
          })
        )
      )
    )
  )

export interface NativeApplication extends ApplicationAdapter {
  readonly source: Source
  readonly register: <A, E, R>(
    body: (handle: Handle) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlInvalidHandle, R>
  readonly instrument: <A, E, R>(
    body: (handle: Handle) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | PostgreSqlInvalidHandle, R>
  readonly sanitizeControls: typeof sanitizeControls
  readonly controls: Array<string>
}
export const make = (client: PgClient): NativeApplication => {
  const source = Object.freeze({ client })
  const controls: Array<string> = []
  const validate = (handle: unknown): Effect.Effect<TransactionQuery, PostgreSqlError> =>
    Effect.suspend(() => {
      const state = handles.get(handle as Handle)
      if (!state) {
        return Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" }))
      }
      if (state.source !== source) {
        return Effect.fail(new PostgreSqlInvalidHandle({ reason: "foreign-source" }))
      }
      if (!state.active) {
        return Effect.fail(new PostgreSqlInvalidHandle({ reason: "inactive-handle" }))
      }
      return Effect.succeed({
        query: (text, values = []) =>
          validate(handle).pipe(
            Effect.flatMap(() => state.connection.execute(text, values, undefined)),
            // Native int8 is bigint. Retain exact decimals for the existing pg row
            // contract; never cast unbounded int8 values directly to JS numbers.
            Effect.map((rows) =>
              rows.map((row: Record<string, unknown>) =>
                Object.fromEntries(
                  Object.entries(row).map(([key, value]) => [
                    key,
                    typeof value === "bigint" ? value.toString() : value
                  ])
                )
              )
            ),
            Effect.mapError((error) =>
              error instanceof PostgreSqlInvalidHandle
                ? error
                : new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
            )
          )
      } satisfies TransactionQuery)
    })
  const register: NativeApplication["register"] = (body) =>
    Effect.gen(function* () {
      const active = yield* Effect.serviceOption(client.transactionService)
      if (Option.isNone(active)) {
        return yield* new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
      }
      const state: State = { source, connection: active.value[0], active: true }
      const handle = Object.freeze({ token: Symbol() })
      handles.set(handle, state)
      return yield* Effect.suspend(() => body(handle)).pipe(
        Effect.provideService(Current, Option.some(handle)),
        Effect.ensuring(
          Effect.sync(() => {
            state.active = false
          })
        )
      )
    })
  const withTransaction: ApplicationAdapter["withTransaction"] = <A, E, R>(
    body: (handle: unknown) => Effect.Effect<A, E, R>
  ) =>
    Current.pipe(
      Effect.flatMap((current) =>
        Option.isSome(current)
          ? validate(current.value).pipe(Effect.flatMap(() => body(current.value)))
          : Effect.serviceOption(client.transactionService).pipe(
              Effect.flatMap((active) =>
                Option.isSome(active)
                  ? Effect.fail(
                      new PostgreSqlInvalidHandle({ reason: "unqualified-handle" })
                    )
                  : sanitizeControls<A, E | PostgreSqlInvalidHandle, R>(
                      client.withTransaction(register(body))
                    )
              )
            )
      )
    )
  const ownedTransaction: ApplicationAdapter["ownedTransaction"] = <A, E, R>(
    body: (query: TransactionQuery) => Effect.Effect<A, E, R>
  ) =>
    Effect.serviceOption(client.transactionService).pipe(
      Effect.flatMap((active) =>
        Option.isSome(active)
          ? Effect.fail(new PostgreSqlInvalidHandle({ reason: "active-transaction" }))
          : sanitizeControls<A, E | PostgreSqlError, R>(
              client.withTransaction(
                register((handle) => validate(handle).pipe(Effect.flatMap(body)))
              )
            )
      )
    )
  // Observe actual native controls, including the raw checked COMMIT. Wrappers
  // belong to the reserved native ConnectionImpl, not a shared driver prototype.
  const instrument: NativeApplication["instrument"] = (body) =>
    register((handle) =>
      Effect.gen(function* () {
        const active = yield* Effect.serviceOption(client.transactionService)
        if (Option.isNone(active)) {
          return yield* new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
        }
        const [connection] = active.value
        const execute = connection.execute.bind(connection)
        const executeRaw = connection.executeRaw.bind(connection)
        Object.assign(connection, {
          execute: (...args: Parameters<typeof execute>) => {
            if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(args[0])) {
              controls.push(args[0])
            }
            return execute(...args)
          },
          executeRaw: (...args: Parameters<typeof executeRaw>) => {
            if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(args[0])) {
              controls.push(args[0])
            }
            return executeRaw(...args)
          }
        })
        return yield* body(handle)
      })
    )
  return {
    source,
    validate,
    register,
    instrument,
    withTransaction,
    ownedTransaction,
    sanitizeControls,
    controls
  }
}
