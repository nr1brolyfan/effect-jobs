import { Cause, Context, Effect, Layer, Schema } from "effect"
import {
  JobDetail,
  JobDetailRequest,
  JobPage,
  JobSummary,
  JobStats,
  ListJobs
} from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobsRead, PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Queries from "../../../../playground-worker/src/persistence/read/Queries.js"
import { CursorCodec } from "./CursorCodec.js"

// Application owns pool, cancellation, finite acquisition/control/release budgets
// and SELECT-only credentials. Driver qualification is separate from this port.
export class ReadDatabase extends Context.Service<
  ReadDatabase,
  {
    readonly execute: (query: Queries.Query) => Effect.Effect<unknown, PlaygroundError>
  }
>()("playground/read/ReadDatabase") {}
const Status = Schema.Literals(["ok", "sandbox-expired", "stale-generation"])
const ListRows = Schema.Array(
  Schema.Struct({
    status: Status,
    items: Schema.Array(JobSummary).pipe(Schema.check(Schema.isMaxLength(51))),
    stats: JobStats
  })
).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
const DetailRows = Schema.Array(
  Schema.Struct({ status: Status, detail: Schema.NullOr(JobDetail) })
).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
const sameRef = (left: SandboxRef, right: SandboxRef) =>
  left.sandboxId === right.sandboxId && left.generation === right.generation
const authorize = (access: SandboxAccess, requested: SandboxRef) => {
  if (access.sandbox.ref.sandboxId !== requested.sandboxId) {
    return Effect.fail(new PlaygroundError({ code: "not-found" }))
  }
  if (!sameRef(access.sandbox.ref, requested)) {
    return Effect.fail(new PlaygroundError({ code: "stale-generation" }))
  }
  return Effect.void
}
const checkStatus = (status: typeof Status.Type) =>
  status === "ok" ? Effect.void : Effect.fail(new PlaygroundError({ code: status }))
// mapError recovers one typed failure and can discard a mixed interruption.
// Sanitize typed reasons while retaining the resource lifetime's full Cause.
const unavailableCause = <E>(cause: Cause.Cause<E>) =>
  Effect.failCause(Cause.map(cause, () => new PlaygroundError({ code: "unavailable" })))
export const make = (mapping: Queries.Mapping) =>
  Effect.gen(function* () {
    const database = yield* ReadDatabase
    const cursor = yield* CursorCodec
    const queries = Queries.make(mapping)
    const execute = (query: Queries.Query) =>
      database.execute(query).pipe(
        Effect.catchCause(unavailableCause),
        Effect.timeoutOrElse({
          duration: "2 seconds",
          orElse: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
        })
      )
    const list: (typeof JobsRead.Service)["list"] = Effect.fn("JobsRead.list")(
      function* (access, input) {
        const request = yield* Schema.decodeUnknownEffect(ListJobs)(input, {
          onExcessProperty: "error"
        }).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
        yield* authorize(access, request.sandbox)
        let after: string | null = null
        if (request.cursor !== undefined) {
          const position = yield* cursor.decode(request.cursor)
          if (
            !sameRef(position.sandbox, request.sandbox) ||
            position.filters.state !== request.filters.state ||
            position.filters.kind !== request.filters.kind
          ) {
            return yield* new PlaygroundError({ code: "invalid-request" })
          }
          after = position.after
        }
        const rows = yield* execute(
          queries.list(access.sandbox.ref, request, after)
        ).pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(ListRows)(value, { onExcessProperty: "error" })
          ),
          Effect.catchCause(unavailableCause)
        )
        const row = rows[0]!
        yield* checkStatus(row.status)
        const items = row.items.slice(0, request.limit)
        const nextCursor =
          row.items.length > request.limit
            ? yield* cursor.encode({
                version: 1,
                sandbox: request.sandbox,
                filters: request.filters,
                after: items.at(-1)!.jobId
              })
            : null
        return yield* Schema.decodeUnknownEffect(JobPage)(
          { sandbox: request.sandbox, items, nextCursor, stats: row.stats },
          { onExcessProperty: "error" }
        ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
      }
    )
    const detail: (typeof JobsRead.Service)["detail"] = Effect.fn("JobsRead.detail")(
      function* (access, input) {
        const request = yield* Schema.decodeUnknownEffect(JobDetailRequest)(input, {
          onExcessProperty: "error"
        }).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
        if (request.jobId.length > 128) {
          return yield* new PlaygroundError({ code: "invalid-request" })
        }
        yield* authorize(access, request.sandbox)
        const rows = yield* execute(queries.detail(access.sandbox.ref, request)).pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(DetailRows)(value, { onExcessProperty: "error" })
          ),
          Effect.catchCause(unavailableCause)
        )
        const row = rows[0]!
        yield* checkStatus(row.status)
        if (row.detail === null) {
          return yield* new PlaygroundError({ code: "not-found" })
        }
        if (
          !sameRef(row.detail.sandbox, request.sandbox) ||
          row.detail.job.jobId !== request.jobId
        ) {
          return yield* new PlaygroundError({ code: "unavailable" })
        }
        return row.detail
      }
    )
    return JobsRead.of({ list, detail })
  })
export const layerNoDeps = (mapping: Queries.Mapping) =>
  Layer.effect(JobsRead, make(mapping))
