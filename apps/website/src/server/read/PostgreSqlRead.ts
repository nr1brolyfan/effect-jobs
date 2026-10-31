import { Cause, Context, Effect, Layer, Schema } from "effect"
import {
  JobDetail,
  JobDetailRequest,
  JobPage,
  JobProblemPage,
  JobProblemRow,
  JobHistory,
  JobHistoryItem,
  JobRelatedPage,
  JobRelatedItem,
  Cursor,
  JobSummary,
  JobStats,
  ListJobs
} from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobsRead, PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Queries from "../../../../playground-worker/src/persistence/read/Queries.js"
import * as Projection from "./JobDetailsProjection.js"
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
const listRows = <S extends Schema.Top & { readonly DecodingServices: never }>(item: S) =>
  Schema.Array(
    Schema.Struct({
      status: Status,
      items: Schema.Array(item).pipe(Schema.check(Schema.isMaxLength(51))),
      filteredTotal: JobPage.fields.filteredTotal,
      stats: JobStats,
      attentionStats: JobPage.fields.attentionStats
    })
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
const ListRows = listRows(JobSummary)
const ProblemRows = listRows(JobProblemRow)
const BaseDetail = Schema.Struct({
  sandbox: JobDetail.fields.sandbox,
  job: JobDetail.fields.job,
  producer: JobDetail.fields.producer,
  policy: JobDetail.fields.policy,
  relations: JobDetail.fields.relations
})
const KeyedHistory = Schema.Struct({
  key: Schema.String.pipe(Schema.check(Schema.isMaxLength(512))),
  item: JobHistoryItem
})
const DetailRows = Schema.Array(
  Schema.Struct({
    status: Status,
    detail: BaseDetail.pipe(Schema.NullOr),
    problem: Schema.Struct({
      rootJobId: JobSummary.fields.jobId,
      problem: JobDetail.fields.problem
    }).pipe(Schema.NullOr),
    provider: Schema.Struct({
      accepted: Schema.Boolean,
      invocations: JobSummary.fields.attemptsMade
    }).pipe(Schema.NullOr),
    lineage: JobDetail.fields.lineage,
    format_version: Schema.Unknown,
    payload: Schema.Unknown,
    projection: Schema.Unknown,
    related: Schema.Array(JobRelatedItem).pipe(Schema.check(Schema.isMaxLength(51))),
    history: Schema.Array(KeyedHistory).pipe(Schema.check(Schema.isMaxLength(51)))
  })
).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
const Subread = Schema.Struct({
  ...JobDetailRequest.fields,
  cursor: Cursor.pipe(Schema.optional),
  limit: ListJobs.fields.limit
})
const invalid = () => new PlaygroundError({ code: "invalid-request" })
const unavailable = () => new PlaygroundError({ code: "unavailable" })
const strict = { onExcessProperty: "error" } as const
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
    const position = (request: typeof ListJobs.Type, view: "jobs" | "problems") =>
      Effect.gen(function* () {
        if (request.cursor === undefined) {
          return null
        }
        const decoded = yield* cursor.decode(request.cursor)
        if (
          !sameRef(decoded.sandbox, request.sandbox) ||
          (decoded.version === 1 ? view !== "jobs" : decoded.view !== view) ||
          !("filters" in decoded) ||
          decoded.filters.state !== request.filters.state ||
          decoded.filters.name !== request.filters.name ||
          decoded.filters.resolution !== request.filters.resolution ||
          decoded.filters.needsAttention !== request.filters.needsAttention
        ) {
          return yield* invalid()
        }
        return decoded.after
      })
    const list: (typeof JobsRead.Service)["list"] = Effect.fn("JobsRead.list")(
      function* (access, input) {
        const request = yield* Schema.decodeUnknownEffect(ListJobs)(input, strict).pipe(
          Effect.mapError(invalid)
        )
        if (
          request.filters.resolution !== undefined ||
          request.filters.needsAttention !== undefined
        ) {
          return yield* invalid()
        }
        yield* authorize(access, request.sandbox)
        const after = yield* position(request, "jobs")
        const rows = yield* execute(
          queries.list(access.sandbox.ref, request, after)
        ).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(ListRows)(value, strict)),
          Effect.catchCause(unavailableCause)
        )
        const row = rows[0]!
        yield* checkStatus(row.status)
        const items = row.items.slice(0, request.limit)
        const nextCursor =
          row.items.length > request.limit
            ? yield* cursor.encode({
                version: 2,
                view: "jobs",
                sandbox: request.sandbox,
                filters: request.filters,
                after: items.at(-1)!.jobId
              })
            : null
        return yield* Schema.decodeUnknownEffect(JobPage)(
          {
            sandbox: request.sandbox,
            items,
            nextCursor,
            filteredTotal: row.filteredTotal,
            stats: row.stats,
            attentionStats: row.attentionStats
          },
          strict
        ).pipe(Effect.mapError(unavailable))
      }
    )
    const problems: (typeof JobsRead.Service)["problems"] = Effect.fn(
      "JobsRead.problems"
    )(function* (access, input) {
      const request = yield* Schema.decodeUnknownEffect(ListJobs)(input, strict).pipe(
        Effect.mapError(invalid)
      )
      yield* authorize(access, request.sandbox)
      const after = yield* position(request, "problems")
      const rows = yield* execute(
        queries.problems(access.sandbox.ref, request, after)
      ).pipe(
        Effect.flatMap((value) => Schema.decodeUnknownEffect(ProblemRows)(value, strict)),
        Effect.catchCause(unavailableCause)
      )
      const row = rows[0]!
      yield* checkStatus(row.status)
      const items = row.items.slice(0, request.limit)
      const nextCursor =
        row.items.length > request.limit
          ? yield* cursor.encode({
              version: 2,
              view: "problems",
              sandbox: request.sandbox,
              filters: request.filters,
              after: items.at(-1)!.problem.rootJobId
            })
          : null
      return yield* Schema.decodeUnknownEffect(JobProblemPage)(
        {
          sandbox: request.sandbox,
          items,
          nextCursor,
          filteredTotal: row.filteredTotal,
          stats: row.stats,
          attentionStats: row.attentionStats
        },
        strict
      ).pipe(Effect.mapError(unavailable))
    })
    const historyPage = (
      request: JobDetailRequest,
      items: ReadonlyArray<typeof KeyedHistory.Type>,
      limit: number
    ) =>
      Effect.gen(function* () {
        const page = items.slice(0, limit)
        const nextCursor =
          items.length > limit
            ? yield* cursor.encode({
                version: 2,
                view: "history",
                sandbox: request.sandbox,
                jobId: request.jobId,
                after: page.at(-1)!.key
              })
            : null
        return {
          coverage: "RetainedFacts" as const,
          attempts: null,
          items: page.map((entry) => entry.item),
          nextCursor
        }
      })
    const relatedPage = (
      request: JobDetailRequest,
      items: ReadonlyArray<typeof JobRelatedItem.Type>,
      limit: number
    ) =>
      Effect.gen(function* () {
        const page = items.slice(0, limit)
        const nextCursor =
          items.length > limit
            ? yield* cursor.encode({
                version: 2,
                view: "related",
                sandbox: request.sandbox,
                jobId: request.jobId,
                after: page.at(-1)!.jobId
              })
            : null
        return { items: page, nextCursor }
      })
    const detail: (typeof JobsRead.Service)["detail"] = Effect.fn("JobsRead.detail")(
      function* (access, input) {
        const request = yield* Schema.decodeUnknownEffect(JobDetailRequest)(
          input,
          strict
        ).pipe(Effect.mapError(invalid))
        if (request.jobId.length > 128) {
          return yield* invalid()
        }
        yield* authorize(access, request.sandbox)
        const rows = yield* execute(queries.detail(access.sandbox.ref, request)).pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(DetailRows)(value, strict)
          ),
          Effect.catchCause(unavailableCause)
        )
        const row = rows[0]!
        yield* checkStatus(row.status)
        if (!row.detail) {
          return yield* new PlaygroundError({ code: "not-found" })
        }
        if (
          !sameRef(row.detail.sandbox, request.sandbox) ||
          row.detail.job.jobId !== request.jobId
        ) {
          return yield* unavailable()
        }
        const payload = yield* Projection.payload(row.detail, row)
        const problem = row.problem?.problem ?? null
        const projected = {
          ...row.detail,
          ...Projection.retainedFields,
          payload,
          problem,
          lineage: row.lineage,
          provider: row.provider
            ? { source: "synthetic-postgresql", ...row.provider, observedAt: null }
            : null,
          history: yield* historyPage(request, row.history, 50),
          related: yield* relatedPage(request, row.related, 50),
          eligibility: Projection.eligibility(row.detail, problem, payload)
        }
        return yield* Schema.decodeUnknownEffect(JobDetail)(projected, strict).pipe(
          Effect.mapError(unavailable)
        )
      }
    )
    const subread = (
      access: SandboxAccess,
      input: unknown,
      view: "history" | "related"
    ) =>
      Effect.gen(function* () {
        const request = yield* Schema.decodeUnknownEffect(Subread)(input, strict).pipe(
          Effect.mapError(invalid)
        )
        yield* authorize(access, request.sandbox)
        if (request.jobId.length > 128) {
          return yield* invalid()
        }
        let after: string | null = null
        if (request.cursor !== undefined) {
          const decoded = yield* cursor.decode(request.cursor)
          if (
            decoded.version !== 2 ||
            decoded.view !== view ||
            !("jobId" in decoded) ||
            !sameRef(decoded.sandbox, request.sandbox) ||
            decoded.jobId !== request.jobId
          ) {
            return yield* invalid()
          }
          after = decoded.after
        }
        if (view === "history") {
          const rows = yield* execute(
            queries.history(request.sandbox, request, after)
          ).pipe(
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(
                Schema.Array(
                  Schema.Struct({
                    status: Status,
                    found: Schema.Boolean,
                    items: Schema.Array(KeyedHistory).pipe(
                      Schema.check(Schema.isMaxLength(51))
                    )
                  })
                ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
              )(value, strict)
            ),
            Effect.catchCause(unavailableCause)
          )
          const row = rows[0]!
          yield* checkStatus(row.status)
          if (!row.found) {
            return yield* new PlaygroundError({ code: "not-found" })
          }
          return yield* Schema.decodeUnknownEffect(JobHistory)(
            yield* historyPage(request, row.items, request.limit),
            strict
          ).pipe(Effect.mapError(unavailable))
        }
        const rows = yield* execute(
          queries.related(request.sandbox, request, after)
        ).pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(
              Schema.Array(
                Schema.Struct({
                  status: Status,
                  found: Schema.Boolean,
                  items: Schema.Array(JobRelatedItem).pipe(
                    Schema.check(Schema.isMaxLength(51))
                  )
                })
              ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1)))
            )(value, strict)
          ),
          Effect.catchCause(unavailableCause)
        )
        const row = rows[0]!
        yield* checkStatus(row.status)
        if (!row.found) {
          return yield* new PlaygroundError({ code: "not-found" })
        }
        return yield* Schema.decodeUnknownEffect(JobRelatedPage)(
          yield* relatedPage(request, row.items, request.limit),
          strict
        ).pipe(Effect.mapError(unavailable))
      })
    return JobsRead.of({
      list,
      detail,
      problems,
      history: (access, input) =>
        subread(access, input, "history").pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(JobHistory)(value, strict)
          ),
          Effect.mapError((error) =>
            error instanceof PlaygroundError ? error : unavailable()
          )
        ),
      related: (access, input) =>
        subread(access, input, "related").pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(JobRelatedPage)(value, strict)
          ),
          Effect.mapError((error) =>
            error instanceof PlaygroundError ? error : unavailable()
          )
        )
    })
  })
export const layerNoDeps = (mapping: Queries.Mapping) =>
  Layer.effect(JobsRead, make(mapping))
