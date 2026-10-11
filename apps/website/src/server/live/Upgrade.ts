import { Effect, Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { objectName } from "./PostCommit.js"

export interface UpgradeNamespace {
  getByName(name: string): { fetch(request: Request): Promise<Response> }
}

// Public GET route. Origin is required because browser WebSockets carry cookies.
// Authority must consume the HttpOnly cookie; no client-selected sandbox routing.
export const upgrade = (
  request: Request,
  origin: string,
  namespace: UpgradeNamespace,
  authorize: (request: Request) => Effect.Effect<SandboxView, PlaygroundError>
) => {
  if (
    request.method !== "GET" ||
    request.headers.get("Origin") !== origin ||
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
    Effect.catchCause(() =>
      Effect.succeed(Response.json({ code: "unavailable" }, { status: 503 }))
    )
  )
}
