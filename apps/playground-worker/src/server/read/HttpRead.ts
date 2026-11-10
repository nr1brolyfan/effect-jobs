import { Cause, Effect, Schema } from "effect"
import {
  JobDetailRequest,
  ListJobs,
  Cursor
} from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  JobsRead,
  PlaygroundError,
  toPublicError
} from "@effect-jobs/playground-contracts/Services"

const statuses = {
  "invalid-request": 400,
  "not-found": 404,
  "sandbox-expired": 401,
  "stale-generation": 409,
  "limit-reached": 429,
  "capability-unavailable": 501,
  unavailable: 503
} as const
const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  })
// The route owner authenticates the HttpOnly capability BEFORE calling this.
// `access` is trusted Context output, never decoded from request parameters.
// Path matching is owned by Routes.ts; this handler only implements GET reads.
export const handle = (
  access: SandboxAccess,
  request: Request,
  operation: "list" | "detail" | "problems" | "history" | "related"
) =>
  Effect.gen(function* () {
    if (request.method !== "GET" || request.url.length > 4096) {
      return yield* new PlaygroundError({ code: "invalid-request" })
    }
    const url = new URL(request.url)
    const allowed =
      operation === "list" || operation === "problems"
        ? [
            "sandboxId",
            "generation",
            "state",
            "name",
            "resolution",
            "needsAttention",
            "limit",
            "cursor"
          ]
        : operation === "detail"
          ? ["sandboxId", "generation", "jobId"]
          : ["sandboxId", "generation", "jobId", "limit", "cursor"]
    for (const key of url.searchParams.keys()) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
        return yield* new PlaygroundError({ code: "invalid-request" })
      }
    }
    const sandbox = {
      sandboxId: url.searchParams.get("sandboxId"),
      generation: Number(url.searchParams.get("generation"))
    }
    const service = yield* JobsRead
    if (operation === "detail") {
      // Schema decoding remains in JobsRead at the service boundary.
      const input = yield* Schema.decodeUnknownEffect(JobDetailRequest)(
        { sandbox, jobId: url.searchParams.get("jobId") },
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
      return response(yield* service.detail(access, input))
    }
    if (operation === "history" || operation === "related") {
      const position = url.searchParams.get("cursor")
      const input = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          ...JobDetailRequest.fields,
          limit: ListJobs.fields.limit,
          cursor: Cursor.pipe(Schema.optional)
        })
      )(
        {
          sandbox,
          jobId: url.searchParams.get("jobId"),
          limit: url.searchParams.has("limit")
            ? Number(url.searchParams.get("limit"))
            : 25,
          ...(position === null ? {} : { cursor: position })
        },
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
      return response(
        operation === "history"
          ? yield* service.history(access, input)
          : yield* service.related(access, input)
      )
    }
    const resolution = url.searchParams.get("resolution")
    const needsAttention = url.searchParams.get("needsAttention")
    if (needsAttention !== null && needsAttention !== "true") {
      return yield* new PlaygroundError({ code: "invalid-request" })
    }
    const state = url.searchParams.get("state")
    const name = url.searchParams.get("name")
    const cursor = url.searchParams.get("cursor")
    const input = yield* Schema.decodeUnknownEffect(ListJobs)(
      {
        sandbox,
        filters: {
          ...(state === null ? {} : { state }),
          ...(name === null ? {} : { name }),
          ...(resolution === null ? {} : { resolution }),
          ...(needsAttention === null ? {} : { needsAttention: true })
        },
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 25,
        ...(cursor === null ? {} : { cursor })
      },
      { onExcessProperty: "error" }
    ).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
    return response(
      operation === "problems"
        ? yield* service.problems(access, input)
        : yield* service.list(access, input)
    )
  }).pipe(
    Effect.catchCause((cause) => {
      // Resource release can add a typed failure to an interrupted read.
      // Inspect the full Cause before recovering any public error.
      if (cause.reasons.some(Cause.isInterruptReason)) {
        return Effect.failCause(cause)
      }
      const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined
      const failure =
        reason && Cause.isFailReason(reason) && reason.error instanceof PlaygroundError
          ? reason
          : undefined
      return Effect.succeed(
        failure === undefined
          ? response({ code: "unavailable" }, 503)
          : response(toPublicError(failure.error), statuses[failure.error.code])
      )
    })
  )
