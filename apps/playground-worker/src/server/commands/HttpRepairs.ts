import { Cause, Effect, Option, Schema } from "effect"
import {
  Repairs,
  JobRepairCommand,
  JobResolutionCommand,
  JobRepairReceiptRequest,
  JobRepairResult,
  JobResolutionResult
} from "@effect-jobs/playground-contracts/Repairs"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  PlaygroundError,
  toPublicError
} from "@effect-jobs/playground-contracts/Services"
import { LiveNotifications } from "../live/PostCommit.js"

export type Operation = "repair" | "repairReceipt" | "resolution" | "resolutionReceipt"
export const maximumBodyBytes = 128 * 1024
const invalid = () => new PlaygroundError({ code: "invalid-request" })
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
export const body = (request: Request) =>
  Effect.acquireUseRelease(
    Effect.sync(() => request.body?.getReader()),
    (reader) =>
      reader === undefined
        ? Effect.fail(invalid())
        : Effect.gen(function* () {
            const chunks: Uint8Array[] = []
            let size = 0
            for (;;) {
              const chunk = yield* Effect.tryPromise({
                try: () => reader.read(),
                catch: invalid
              })
              if (chunk.done) {
                break
              }
              size += chunk.value.byteLength
              if (size > maximumBodyBytes) {
                return yield* invalid()
              }
              chunks.push(chunk.value)
            }
            return yield* Effect.try({
              try: () => {
                const bytes = new Uint8Array(size)
                let offset = 0
                for (const chunk of chunks) {
                  bytes.set(chunk, offset)
                  offset += chunk.byteLength
                }
                return JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(bytes)
                ) as unknown
              },
              catch: invalid
            })
          }),
    (reader) =>
      reader === undefined
        ? Effect.void
        : Effect.tryPromise({ try: () => reader.cancel(), catch: () => undefined }).pipe(
            Effect.ignore,
            Effect.interruptible,
            Effect.timeoutOption(100),
            Effect.ensuring(Effect.sync(() => reader.releaseLock()))
          )
  ).pipe(Effect.timeout("2 seconds"), Effect.mapError(invalid))

// Serial route owner authenticates, enforces LOCAL_PRIVATE and rate limits
// BEFORE invoking this handler. Expected origin is trusted configuration.
export const handle = (
  access: SandboxAccess,
  request: Request,
  operation: Operation,
  expectedOrigin: string
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (
      request.method !== "POST" ||
      request.url.length > 4096 ||
      url.search !== "" ||
      url.origin !== expectedOrigin ||
      request.headers.get("Origin") !== expectedOrigin ||
      request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json" ||
      (request.headers.has("Sec-Fetch-Site") &&
        request.headers.get("Sec-Fetch-Site") !== "same-origin")
    ) {
      return yield* invalid()
    }
    const service = yield* Repairs
    const raw = yield* body(request)
    const strict = { onExcessProperty: "error" } as const
    const checked = <S extends Schema.Top & { readonly DecodingServices: never }>(
      schema: S
    ) => Schema.decodeUnknownEffect(schema)(raw, strict).pipe(Effect.mapError(invalid))
    const result =
      operation === "repair"
        ? yield* service.execute(access, yield* checked(JobRepairCommand))
        : operation === "repairReceipt"
          ? yield* service.receipt(access, yield* checked(JobRepairReceiptRequest))
          : operation === "resolution"
            ? yield* service.resolve(access, yield* checked(JobResolutionCommand))
            : yield* service.resolutionReceipt(
                access,
                yield* checked(JobRepairReceiptRequest)
              )
    const decoded =
      operation === "repair" || operation === "repairReceipt"
        ? yield* Schema.decodeUnknownEffect(JobRepairResult)(result, strict).pipe(
            Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
          )
        : yield* Schema.decodeUnknownEffect(JobResolutionResult)(result, strict).pipe(
            Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
          )
    if (
      decoded._tag === "Committed" &&
      (operation === "repair" || operation === "resolution")
    ) {
      const notifications = yield* Effect.serviceOption(LiveNotifications)
      if (Option.isSome(notifications)) {
        yield* notifications.value.committed(decoded.sandbox)
      }
    }
    return response(decoded, decoded._tag === "OutcomeUnknown" ? 202 : 200)
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) {
        return Effect.failCause(cause)
      }
      const single = cause.reasons.length === 1 ? cause.reasons[0] : undefined
      if (
        single &&
        Cause.isFailReason(single) &&
        single.error instanceof PlaygroundError
      ) {
        return Effect.succeed(
          response(toPublicError(single.error), statuses[single.error.code])
        )
      }
      return Effect.succeed(response({ code: "unavailable" }, 503))
    })
  )
