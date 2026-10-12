import { Effect } from "effect"
import { Application } from "../../../website/src/server/Services.js"
import * as Http from "../../../website/src/server/HttpApplication.js"
import * as Upgrade from "../../../website/src/server/live/Upgrade.js"
import * as Read from "../../../website/src/server/read/HttpRead.js"
import { JobsRead, PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Manager from "./Manager.js"
import type { Env } from "../Worker.js"
import * as OriginPolicy from "../../../website/src/OriginPolicy.js"

export const handle = (
  request: Request,
  env: Env & { readonly LOCAL_PREVIEW?: string }
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const policy = OriginPolicy.make({
      configuredOrigin: env.ORIGIN,
      localPreview: env.LOCAL_PREVIEW === "true"
    })
    if (
      request.url.length > 4096 ||
      policy.resolve(url.origin) === undefined ||
      request.method !== "GET"
    ) {
      return Http.response({ code: "invalid-request" }, 400)
    }
    const sandbox = yield* Manager.current(env.SCHEMA).pipe(
      Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
    )
    const access = { sandbox }
    if (url.pathname === "/api/demo") {
      return Http.response(sandbox)
    }
    if (url.pathname === "/api/demo/changes") {
      return yield* Upgrade.upgrade(request, policy, env.LIVE, () =>
        Effect.succeed(sandbox)
      )
    }
    if (url.pathname !== "/api/demo/jobs" && url.pathname !== "/api/demo/jobs/detail") {
      return Http.response({ code: "capability-unavailable" }, 501)
    }
    const app = yield* Application
    return yield* Read.handle(
      access,
      request,
      url.pathname.endsWith("detail") ? "detail" : "list"
    ).pipe(Effect.provideService(JobsRead, app))
  })
