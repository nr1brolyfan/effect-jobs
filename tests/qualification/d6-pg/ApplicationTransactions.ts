/** Application-owned pg manager. Not a library backend or a copy of auth's executor. */
import { Context, Data, Effect, Exit, Option } from "effect"
import { Pool, type PoolClient, type QueryResultRow } from "pg"

export class PgFailure extends Data.TaggedError("PgFailure")<{
  readonly commitKnowledge: "NotCommitted" | "Unknown"
}> {}
export class InvalidHandle extends Data.TaggedError("InvalidHandle")<{
  readonly reason: "foreign-source" | "unqualified-handle" | "inactive-handle"
}> {}

export interface Handle {
  readonly query: <A extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>
  ) => Effect.Effect<ReadonlyArray<A>, PgFailure | InvalidHandle>
}
interface State {
  readonly source: Source
  readonly client: PoolClient
  active: boolean
}
const handles = new WeakMap<Handle, State>()
const Current = Context.Reference<Option.Option<Handle>>("d6/Current", {
  defaultValue: Option.none
})
export interface Counters {
  borrows: number
  readonly sql: Array<string>
  readonly pids: Array<number>
}
export interface Source {
  readonly pool: Pool
  readonly counters: Counters
}
/** Only a concrete pg Pool, with application-managed configuration and lifetime. */
export const source = (pool: Pool): Source => {
  if (!(pool instanceof Pool)) {
    throw new InvalidHandle({ reason: "unqualified-handle" })
  }
  return Object.freeze({ pool, counters: { borrows: 0, sql: [], pids: [] } })
}

export const validate = (source: Source, handle: Handle) =>
  Effect.suspend(() => {
    const state = handles.get(handle)
    if (state === undefined) {
      return Effect.fail(new InvalidHandle({ reason: "unqualified-handle" }))
    }
    if (state.source !== source) {
      return Effect.fail(new InvalidHandle({ reason: "foreign-source" }))
    }
    return state.active
      ? Effect.void
      : Effect.fail(new InvalidHandle({ reason: "inactive-handle" }))
  })

export type CommitFault = "before-send" | "after-durable" | undefined

export const transaction = <A, E, R>(
  source: Source,
  body: (handle: Handle) => Effect.Effect<A, E, R>,
  fault?: CommitFault
): Effect.Effect<A, E | PgFailure | InvalidHandle, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          source.counters.borrows++
          return await source.pool.connect()
        },
        catch: () => new PgFailure({ commitKnowledge: "NotCommitted" })
      }),
      (client) => {
        const state: State = { source, client, active: true }
        const handle: Handle = Object.freeze({
          query: <Row extends QueryResultRow>(
            text: string,
            values: ReadonlyArray<unknown> = []
          ) =>
            validate(source, handle).pipe(
              Effect.flatMap(() =>
                Effect.tryPromise({
                  try: async () => {
                    source.counters.sql.push(text)
                    const result = await client.query<Row>(text, Array.from(values))
                    return result.rows
                  },
                  catch: () => new PgFailure({ commitKnowledge: "NotCommitted" })
                })
              )
            )
        })
        handles.set(handle, state)
        const control = (text: string, knowledge: "NotCommitted" | "Unknown") =>
          Effect.tryPromise({
            try: async () => {
              source.counters.sql.push(text)
              await client.query(text)
            },
            catch: () => new PgFailure({ commitKnowledge: knowledge })
          })
        return Effect.gen(function* () {
          yield* control("BEGIN", "NotCommitted")
          const pid = yield* handle.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid"
          )
          source.counters.pids.push(pid[0]!.pid)
          const exit = yield* Effect.exit(
            restore(Effect.suspend(() => body(handle))).pipe(
              Effect.provideService(Current, Option.some(handle))
            )
          )
          // Stop admitting application queries before control/cleanup begins.
          state.active = false
          if (Exit.isFailure(exit)) {
            yield* control("ROLLBACK", "NotCommitted")
            return yield* exit
          }
          // A fault at the commit boundary is never a grant to replay.
          if (fault === "before-send") {
            yield* control("ROLLBACK", "Unknown")
            return yield* new PgFailure({ commitKnowledge: "Unknown" })
          }
          yield* control("COMMIT", "Unknown")
          if (fault === "after-durable") {
            return yield* new PgFailure({ commitKnowledge: "Unknown" })
          }
          return exit.value
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              state.active = false
            })
          )
        )
      },
      (client, exit) => Effect.sync(() => client.release(Exit.isFailure(exit)))
    )
  )

/** Delegated join-or-establish, with no fallback for an incompatible outer source. */
export const withTransaction = <A, E, R>(
  source: Source,
  body: (handle: Handle) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PgFailure | InvalidHandle, R> =>
  Current.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => transaction(source, body),
        onSome: (handle) =>
          validate(source, handle).pipe(
            Effect.flatMap(() => Effect.suspend(() => body(handle)))
          )
      })
    )
  )
