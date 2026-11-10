import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import type { Pool } from "pg"
import * as NodePasswordSession from "../../../src/server/node/NodePasswordSession.js"
import * as PostgreSqlClient from "../../../src/server/postgresql/PostgreSqlClient.js"
import * as PostgreSqlPool from "../../../src/server/postgresql/PostgreSqlPool.js"
import { BrowserSessionHttpApiGroup } from "../../../src/server/http/BrowserSessionHttpApi.js"
import { BrowserPasswordHttpApiGroup } from "../../../src/server/http/BrowserPasswordHttpApi.js"
import type { HttpTrustedIpAddress } from "../../../src/server/http/HttpTrustedIpAddress.js"
import type { RateLimiter } from "../../../src/server/RateLimiter.js"

export const Api = HttpApi.make("mail").add(
  BrowserSessionHttpApiGroup.prefix("/api/auth"),
  BrowserPasswordHttpApiGroup.prefix("/api/auth")
)

// The host owns the pool, limiter, attested ingress, migrations and durable-job consumer.
export const make = (
  pool: Pool,
  databaseOptions: PostgreSqlPool.PostgreSqlExecutionOptions,
  options: NodePasswordSession.HttpOptions,
  limiter: Layer.Layer<RateLimiter>,
  ingress: Layer.Layer<HttpTrustedIpAddress>
) => {
  const database = PostgreSqlClient.layer(databaseOptions).pipe(
    Layer.provide(PostgreSqlPool.layer({ pool }))
  )
  const auth = NodePasswordSession.httpLayer(Api, options).pipe(
    Layer.provide(database),
    Layer.provide(limiter),
    Layer.provide(ingress)
  )
  const http = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(auth),
    Layer.provide(HttpServer.layerServices)
  )
  return HttpRouter.toWebHandler(http)
}

// Keep the returned handler for the installation lifetime; await dispose() before
// closing its pool. Password change and registration are separate capabilities.
