import { Cause, Effect, Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { objectName } from "./PostCommit.js"
import * as OriginPolicy from "../../OriginPolicy.js"

export interface UpgradeNamespace {
  getByName(name: string): { fetch(request: Request): Promise<Response> }
}

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
      Effect.tryPromise({
        try: () => namespace.getByName(objectName(view.ref)).fetch(request),
        catch: () => undefined
      })
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.succeed(Response.json({ code: "unavailable" }, { status: 503 }))
    )
  )
}
