import * as OriginPolicy from "../OriginPolicy.js"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { Operators } from "@effect-jobs/playground-contracts/Operators"
import { Cause, Effect, Redacted } from "effect"
import {
  PlaygroundError,
  JobsRead,
  Scenarios
} from "@effect-jobs/playground-contracts/Services"
import { routes } from "./Routes.js"
import { Application } from "./Services.js"
import * as Commands from "./commands/HttpCommands.js"
import * as Read from "./read/HttpRead.js"

export const credentialCookie = Cookies.hosted.credential
export const csrfCookie = Cookies.hosted.csrf
const cookiePolicy = (request: Request, config: OriginPolicy.Config) => {
  const origin = new URL(request.url).origin
  return OriginPolicy.make(config).resolve(origin) === undefined
    ? undefined
    : Cookies.names(origin, config.localPreview)
}
export const cookie = (request: Request, name: string) => {
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="))
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined
}
const reject = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
export const authenticate = (request: Request, config: OriginPolicy.Config) =>
  Effect.gen(function* () {
    const app = yield* Application
    const policy = cookiePolicy(request, config)
    if (!policy) {
      return yield* reject("invalid-request")
    }
    const credential = cookie(request, policy.credential)
    if (!credential) {
      return yield* reject("not-found")
    }
    return yield* app.authenticate(Redacted.make(credential))
  })
// Origin + Fetch metadata + double-submit token. No credential in JS or DTOs.
export const csrf = (request: Request, config: OriginPolicy.Config, issue = false) => {
  const policy = cookiePolicy(request, config)
  const origin = OriginPolicy.make(config).resolve(new URL(request.url).origin)
  const token = policy ? cookie(request, policy.csrf) : undefined
  return (
    origin !== undefined &&
    request.method === "POST" &&
    new URL(request.url).origin === origin &&
    request.headers.get("Origin") === origin &&
    (!request.headers.has("Sec-Fetch-Site") ||
      request.headers.get("Sec-Fetch-Site") === "same-origin") &&
    request.headers.get("Content-Type")?.split(";")[0]?.trim() === "application/json" &&
    (issue ||
      (token !== undefined &&
        /^[0-9a-f]{64}$/.test(token) &&
        token === request.headers.get("X-Playground-CSRF")))
  )
}
export const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  })
export const handle = (
  request: Request,
  configuredOrigin: string,
  admit: (key: string) => boolean,
  localPreview = false
) =>
  Effect.gen(function* () {
    const config = { configuredOrigin, localPreview }
    const origin = OriginPolicy.make(config).resolve(new URL(request.url).origin)
    if (request.url.length > 4096 || origin === undefined) {
      return yield* reject("invalid-request")
    }
    const path = new URL(request.url).pathname
    const app = yield* Application
    const policy = cookiePolicy(request, config)!
    if (path === routes.sandboxIssue) {
      if (!csrf(request, config, true) || new URL(request.url).search) {
        return yield* reject("invalid-request")
      }
      if (!admit("issue")) {
        return yield* reject("limit-reached")
      }
      // Issuance accepts no request body; prevent an unbounded stream from reaching PG.
      yield* requireEmptyBody(request)
      if (cookie(request, policy.credential) !== undefined) {
        const existing = yield* authenticate(request, config).pipe(
          Effect.map(() => true),
          Effect.catch((error) =>
            error.code === "not-found" || error.code === "sandbox-expired"
              ? Effect.succeed(false)
              : Effect.fail(error)
          )
        )
        if (existing) {
          return yield* reject("invalid-request")
        }
      }
      const issued = yield* app.issue()
      const token = yield* Effect.sync(() =>
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("")
      )
      const out = response(issued.sandbox)
      out.headers.append(
        "Set-Cookie",
        `${policy.credential}=${Redacted.value(issued.credential)}; Path=/${policy.secure}; HttpOnly; SameSite=Strict`
      )
      out.headers.append(
        "Set-Cookie",
        `${policy.csrf}=${token}; Path=/${policy.secure}; SameSite=Strict`
      )
      return out
    }
    const access = yield* authenticate(request, config)
    if (!admit(access.sandbox.ref.sandboxId)) {
      return yield* reject("limit-reached")
    }
    if (path === routes.sandbox) {
      if (!csrf(request, config) || new URL(request.url).search) {
        return yield* reject("invalid-request")
      }
      yield* requireEmptyBody(request)
      return response(yield* app.describe(access))
    }
    if (path === routes.jobs || path === routes.jobDetail) {
      return yield* Read.handle(
        access,
        request,
        path.endsWith("detail") ? "detail" : "list"
      ).pipe(Effect.provideService(JobsRead, app))
    }
    const operations: Record<string, Commands.Operation> = {
      [routes.operator]: "operator",
      [routes.operatorReceipt]: "operatorReceipt",
      [routes.scenarios]: "run",
      [routes.scenarioReceipt]: "scenarioReceipt",
      [routes.reset]: "reset",
      [routes.resetReceipt]: "resetReceipt"
    }
    const operation = operations[path]
    if (!operation) {
      return response({ code: "not-found" }, 404)
    }
    if (!csrf(request, config)) {
      return yield* reject("invalid-request")
    }
    return yield* Commands.handle(access, request, operation, origin).pipe(
      Effect.provideService(Scenarios, app),
      Effect.provideService(Operators, app)
    )
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) {
        return Effect.failCause(cause)
      }
      const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined
      const code =
        reason && Cause.isFailReason(reason) && reason.error instanceof PlaygroundError
          ? reason.error.code
          : "unavailable"
      const status = {
        "invalid-request": 400,
        "not-found": 404,
        "sandbox-expired": 401,
        "stale-generation": 409,
        "limit-reached": 429,
        "capability-unavailable": 501,
        unavailable: 503
      }[code]
      return Effect.succeed(response({ code }, status))
    })
  )

// workerd exposes a stream for an empty POST. Bound reading and cancellation separately.
const requireEmptyBody = (request: Request) =>
  request.body === null
    ? Effect.void
    : Effect.acquireUseRelease(
        Effect.sync(() => request.body!.getReader()),
        (reader) =>
          Effect.tryPromise({
            try: () => reader.read(),
            catch: () => reject("invalid-request")
          }).pipe(
            Effect.flatMap((chunk) =>
              chunk.done ? Effect.void : Effect.fail(reject("invalid-request"))
            ),
            Effect.timeoutOrElse({
              duration: "2 seconds",
              orElse: () => Effect.fail(reject("invalid-request"))
            })
          ),
        (reader) =>
          Effect.promise(async () => {
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([
                reader.cancel().catch(() => undefined),
                new Promise<void>((done) => {
                  timer = setTimeout(done, 100)
                })
              ])
            } finally {
              clearTimeout(timer)
              reader.releaseLock()
            }
          })
      )
