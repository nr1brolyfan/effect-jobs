/** Effect SQL native PostgreSQL integration. No pool or migration ownership. */
// The native SQL contract is intentionally pinned to Effect 4.1.0.
// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Exit, Layer, Option, Schema, Tracer } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { isSqlError, type SqlError } from "effect/sql/SqlError"
import { EpochMillis } from "./JobPolicy.js"
import { PostgreSqlConfigurationError } from "./PostgreSqlSchema.js"
import {
  PostgreSqlApplication,
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "./PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "./PostgreSqlTransaction.js"

/** Only native PgClient@4.1.0 is qualified. Pass the exact application-owned client
 * used by Effect-native Drizzle@1.0.0-rc.5. Other SQL drivers/clients require
 * separate qualification; structural type compatibility is not a driver guarantee.
 * @category models
 */
export interface Options {
  readonly client: Pick<SqlClient, "transactionService" | "withTransaction">
  /** Finite query/body response deadline. Native control/release paths must also be
   * bounded by the application's configured client timeouts. */
  readonly operationTimeoutMillis: number
}

const controls = <A, E, R>(
  effect: Effect.Effect<A, E | SqlError, R>
): Effect.Effect<A, E | PostgreSqlFailure, R> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<E | PostgreSqlFailure>(
          cause.reasons.flatMap<Cause.Reason<E | PostgreSqlFailure>>((reason) => {
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

/** Construct an adapter without borrowing connections or reading keys/env.
 * Ambient enqueue resolves this client's transactionService, with no fallback.
 * The transaction owner must sequence operations and await them in its callback;
 * retaining/forking transaction contexts outside that callback is unsupported.
 * Standalone rejects active same-client transactions and returns after native
 * checked COMMIT. Provider control failures retain Unknown; no automatic replay.
 * @category constructors
 */
export const make = (options: Options): ApplicationAdapter => {
  if (!Schema.is(EpochMillis)(options.operationTimeoutMillis)) {
    throw new PostgreSqlConfigurationError({ field: "operationTimeoutMillis" })
  }
  const { client, operationTimeoutMillis } = options
  // Protect only the native transaction span we create. Restore the host tracer
  // inside the callback: application spans retain their own failure semantics.
  // Controls still see the original Exit, including rollback/release failures.
  const ownedNative = <A, E, R>(body: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const host = yield* Tracer.Tracer
      let selected = false
      const tracer = Tracer.make({
        context: host.context,
        span(options) {
          const span = host.span(options)
          if (selected || options.name !== "sql.transaction") {
            return span
          }
          selected = true
          return {
            _tag: span._tag,
            name: span.name,
            get spanId() {
              return span.spanId
            },
            get traceId() {
              return span.traceId
            },
            parent: span.parent,
            annotations: span.annotations,
            get attributes() {
              return span.attributes
            },
            get links() {
              return span.links
            },
            sampled: span.sampled,
            kind: span.kind,
            get status() {
              return span.status
            },
            end(time, exit) {
              span.attribute(
                "jobs.native.outcome",
                Exit.isSuccess(exit) ? "success" : "unknown"
              )
              span.end(time, Exit.succeed(undefined))
            },
            attribute: (key, value) => span.attribute(key, value),
            event: (name, time, attributes) => span.event(name, time, attributes),
            addLinks: (links) => span.addLinks(links)
          }
        }
      })
      return yield* client
        .withTransaction(body.pipe(Effect.withTracer(host)))
        .pipe(Effect.withTracer(tracer))
    })
  const ambient: Effect.Effect<TransactionQuery, PostgreSqlError> = Effect.gen(
    function* () {
      const active = yield* Effect.serviceOption(client.transactionService)
      if (Option.isNone(active)) {
        return yield* new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
      }
      const connection = active.value[0]
      return {
        query: (text, values = []) =>
          Effect.gen(function* () {
            const current = yield* Effect.serviceOption(client.transactionService)
            if (Option.isNone(current) || current.value[0] !== connection) {
              return yield* new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
            }
            return yield* connection.execute(text, values, undefined).pipe(
              Effect.map((rows) =>
                rows.map((row) =>
                  Object.fromEntries(
                    Object.entries(row).map((entry) => [
                      entry[0],
                      typeof entry[1] === "bigint" ? entry[1].toString() : entry[1]
                    ])
                  )
                )
              ),
              Effect.mapError(
                () => new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
              ),
              Effect.timeoutOrElse({
                duration: operationTimeoutMillis,
                orElse: () =>
                  Effect.fail(new PostgreSqlFailure({ commitKnowledge: "Unknown" }))
              })
            )
          })
      } satisfies TransactionQuery
    }
  )
  const withTransaction: ApplicationAdapter["withTransaction"] = (body) =>
    Effect.gen(function* () {
      const active = yield* Effect.serviceOption(client.transactionService)
      const run = Effect.flatMap(ambient, (query) => Effect.suspend(() => body(query)))
      return yield* Option.isSome(active) ? run : controls(ownedNative(run))
    })
  return {
    ambient,
    // Explicit handles are not used to infer binding on this adapter.
    validate: () =>
      Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" })),
    withTransaction,
    ownedTransaction: (body) =>
      Effect.gen(function* () {
        const active = yield* Effect.serviceOption(client.transactionService)
        if (Option.isSome(active)) {
          return yield* new PostgreSqlInvalidHandle({ reason: "active-transaction" })
        }
        return yield* controls(
          ownedNative(
            Effect.flatMap(ambient, (query) =>
              Effect.suspend(() => body(query)).pipe(
                Effect.timeoutOrElse({
                  duration: operationTimeoutMillis,
                  orElse: () =>
                    Effect.fail(new PostgreSqlFailure({ commitKnowledge: "Unknown" }))
                })
              )
            )
          )
        )
      })
  }
}
/** Supply the application-owned native client explicitly; starts no work.
 * @category layers
 */
export const layer = (options: Options) =>
  Layer.sync(PostgreSqlApplication, () => make(options))
