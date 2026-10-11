import { Cause, Effect, Schema } from "effect"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  ReceiptRequest,
  ResetCommand,
  ResetResult,
  ScenarioCommand,
  ScenarioResult
} from "@effect-jobs/playground-contracts/Scenarios"
import {
  PlaygroundError,
  Scenarios,
  toPublicError
} from "@effect-jobs/playground-contracts/Services"

// Separate from the read budget: a stream cancel promise may never settle.
export const bodyCleanupBudgetMillis = 100

export type Operation = "run" | "reset" | "scenarioReceipt" | "resetReceipt"
const statuses = {
  "invalid-request": 400,
  "not-found": 404,
  "sandbox-expired": 401,
  "stale-generation": 409,
  "limit-reached": 429,
  "capability-unavailable": 501,
  unavailable: 503
} as const
const invalid = () => new PlaygroundError({ code: "invalid-request" })
const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  })

// Fetch stream FFI: bound bytes even when Content-Length is absent/untruthful.
// Release cancels unread input on overflow, failure, timeout or interruption.
const body = (request: Request) =>
  Effect.acquireUseRelease(
    Effect.sync(() => request.body?.getReader()),
    (reader) =>
      reader === undefined
        ? Effect.fail(invalid())
        : Effect.tryPromise({
            try: async () => {
              const chunks: Uint8Array[] = []
              let size = 0
              for (;;) {
                const chunk = await reader.read()
                if (chunk.done) {
                  break
                }
                size += chunk.value.byteLength
                if (size > 4096) {
                  throw invalid()
                }
                chunks.push(chunk.value)
              }
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
          }),
    (reader) =>
      reader === undefined
        ? Effect.void
        : Effect.promise(async () => {
            // Fetch FFI owns the timer and observes late cancel rejection. The
            // finalizer itself must finish even while native cancel stays pending.
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([
                reader.cancel().catch(() => undefined),
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, bodyCleanupBudgetMillis)
                })
              ])
            } finally {
              clearTimeout(timer)
              reader.releaseLock()
            }
          })
  ).pipe(Effect.timeout("2 seconds"), Effect.mapError(invalid))

// Routes must authenticate the capability and apply global/per-sandbox rate limits
// first. expectedOrigin is trusted deployment config, never taken from Host/body.
// Receipts use POST bodies too, keeping opaque request IDs out of URLs.
export const handle = (
  access: SandboxAccess,
  request: Request,
  operation: Operation,
  expectedOrigin: string
) =>
  Effect.gen(function* () {
    if (
      request.method !== "POST" ||
      request.url.length > 4096 ||
      new URL(request.url).search !== "" ||
      request.headers.get("Origin") !== expectedOrigin ||
      new URL(request.url).origin !== expectedOrigin ||
      request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json" ||
      (request.headers.has("Sec-Fetch-Site") &&
        request.headers.get("Sec-Fetch-Site") !== "same-origin")
    ) {
      return yield* invalid()
    }
    const raw = yield* body(request)
    const service = yield* Scenarios
    if (operation === "run") {
      const command = yield* Schema.decodeUnknownEffect(ScenarioCommand)(raw, {
        onExcessProperty: "error"
      }).pipe(Effect.mapError(invalid))
      const result = yield* Schema.decodeUnknownEffect(ScenarioResult)(
        yield* service.run(access, command),
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
      return response(result, result._tag === "OutcomeUnknown" ? 202 : 200)
    }
    if (operation === "reset") {
      const command = yield* Schema.decodeUnknownEffect(ResetCommand)(raw, {
        onExcessProperty: "error"
      }).pipe(Effect.mapError(invalid))
      const result = yield* Schema.decodeUnknownEffect(ResetResult)(
        yield* service.reset(access, command),
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
      return response(result, result._tag === "OutcomeUnknown" ? 202 : 200)
    }
    const receipt = yield* Schema.decodeUnknownEffect(ReceiptRequest)(raw, {
      onExcessProperty: "error"
    }).pipe(Effect.mapError(invalid))
    const result =
      operation === "scenarioReceipt"
        ? yield* Schema.decodeUnknownEffect(ScenarioResult)(
            yield* service.scenarioReceipt(access, receipt),
            { onExcessProperty: "error" }
          ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
        : yield* Schema.decodeUnknownEffect(ResetResult)(
            yield* service.resetReceipt(access, receipt),
            { onExcessProperty: "error" }
          ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    return response(result, result._tag === "OutcomeUnknown" ? 202 : 200)
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) {
        return Effect.failCause(cause)
      }
      const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error._tag === "PlaygroundError"
      ) {
        return Effect.succeed(
          response(toPublicError(reason.error), statuses[reason.error.code])
        )
      }
      return Effect.succeed(response({ code: "unavailable" }, 503))
    })
  )
