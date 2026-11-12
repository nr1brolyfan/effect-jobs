// @effect-diagnostics unstableApiUsage:off
// The native HTTP/SQL APIs are intentionally pinned to Effect 4.1.0.
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Config, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import {
  admitDevelopment,
  AdmissionRejected,
  decodeRequest,
  OperationUnconfirmed
} from "./Domain.js"
import { connection } from "./Database.js"
import { openInvocation } from "./Invocation.js"
import CoordinatorLayer, { BillingCoordinator } from "./Coordinator.js"
import type { HttpEffect } from "alchemy/Http"
import type { RuntimeContext } from "alchemy/RuntimeContext"

export class InvoiceApplication extends Cloudflare.Worker<
  InvoiceApplication,
  { readonly fetch: HttpEffect<RuntimeContext> }
>()("InvoiceApplication") {}

export default InvoiceApplication.make(
  {
    main: import.meta.url,
    compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] }
  },
  Effect.gen(function* () {
    const coordinators = yield* BillingCoordinator
    const database = yield* connection
    const databaseUrl = database.connectionString
    const providerUrl = yield* Config.String("EXAMPLE_PROVIDER_URL")
    return {
      // A real traffic path bootstraps the dormant DO before accepting production.
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const tenantId = yield* admitDevelopment(request.headers.authorization ?? "")
        const input = yield* request.json.pipe(Effect.flatMap(decodeRequest))
        // The namespace is stable; obtain its RPC stub in this invocation.
        const coordinator = coordinators.getByName("billing")
        yield* coordinator
          .prearm()
          .pipe(Effect.mapError(() => new OperationUnconfirmed()))
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const invocation = yield* openInvocation({ databaseUrl, providerUrl })
            return yield* invocation.issue(tenantId, input)
          })
        ).pipe(
          Effect.mapError((error) =>
            error instanceof AdmissionRejected ? error : new OperationUnconfirmed()
          )
        )
        // Failure cannot undo PostgreSQL COMMIT. Prearmed repair remains durable.
        yield* coordinator.wake().pipe(Effect.catch(() => Effect.void))
        return HttpServerResponse.jsonUnsafe(result)
      }).pipe(
        Effect.catchTags({
          AdmissionRejected: () =>
            Effect.succeed(HttpServerResponse.empty({ status: 403 })),
          OperationUnconfirmed: () =>
            Effect.succeed(HttpServerResponse.empty({ status: 503 }))
        }),
        Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      )
    }
  }).pipe(Effect.provide(CoordinatorLayer))
)
