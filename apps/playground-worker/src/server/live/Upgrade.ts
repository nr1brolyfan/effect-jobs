// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as HttpRequest from "effect/http/HttpServerRequest"
import * as HttpResponse from "effect/http/HttpServerResponse"
import * as HttpBody from "effect/http/HttpBody"
import type { LiveNamespace } from "./PostCommit.js"
import { objectName } from "./PostCommit.js"
import * as OriginPolicy from "../../OriginPolicy.js"

export type UpgradeNamespace = LiveNamespace

// Preserve the native upgrade response when crossing the existing Fetch-domain
// boundary; converting a 101 as an ordinary response discards its socket.
export const response = (value: Response) =>
  value.status === 101
    ? HttpResponse.setBody(HttpResponse.empty({ status: 101 }), HttpBody.raw(value))
    : HttpResponse.fromWeb(value)

// Public GET route. Origin is required because browser WebSockets carry cookies.
// Authority must consume the HttpOnly cookie; no client-selected sandbox routing.
export const upgrade = (
  request: Request,
  origin: OriginPolicy.Policy | string,
  namespace: UpgradeNamespace,
  authorize: (request: Request) => Effect.Effect<SandboxView, PlaygroundError>
) => {
  // Legacy string callers remain hosted-only; preview must supply its policy.
  const policy =
    typeof origin === "string"
      ? OriginPolicy.make({ configuredOrigin: origin, localPreview: false })
      : origin
  if (
    request.url.length > 4096 ||
    request.method !== "GET" ||
    !policy.matches(new URL(request.url).origin, request.headers.get("Origin")) ||
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  ) {
    return Effect.succeed(Response.json({ code: "invalid-request" }, { status: 400 }))
  }
  return authorize(request).pipe(
    Effect.flatMap((view) =>
      Schema.decodeUnknownEffect(SandboxView)(view, { onExcessProperty: "error" })
    ),
    Effect.flatMap((view) =>
      namespace
        .getByName(objectName(view.ref))
        .fetch(HttpRequest.fromWeb(request))
        .pipe(Effect.map(HttpResponse.toWeb))
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.succeed(Response.json({ code: "unavailable" }, { status: 503 }))
    )
  )
}
