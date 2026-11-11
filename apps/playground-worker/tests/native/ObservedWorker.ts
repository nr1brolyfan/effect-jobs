// @effect-diagnostics unstableApiUsage:off
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as Response from "effect/http/HttpServerResponse"
import * as Application from "../../src/Worker.js"
import * as Observation from "./QueueObservation.js"

export default Cloudflare.Worker(
  "Worker",
  Application.properties.pipe(
    Effect.map((properties) => ({ ...properties, main: import.meta.url }))
  ),
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker
    const observedExport = (name: string, value: unknown) => {
      const queue = Observation.names.find((candidate) => candidate === name)
      return worker.export(
        name,
        queue && Cloudflare.isDurableObjectExport(value)
          ? Observation.decorate(queue, value)
          : value
      )
    }
    // Resource fields are lazy proxy properties; spreading loses their getters.
    const observedWorker = new Proxy(worker, {
      get: (target, key) => (key === "export" ? observedExport : Reflect.get(target, key))
    })
    const application = yield* Application.implementation.pipe(
      Effect.provideService(Cloudflare.Worker.Self, observedWorker)
    )
    const queues = yield* Effect.all([
      Application.Communications,
      Application.Media,
      Application.Commerce,
      Application.Private
    ]).pipe(Effect.provideService(Cloudflare.Worker.Self, observedWorker))
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        if (new URL(request.url, "http://local").pathname === "/_integration/queues") {
          return Response.jsonUnsafe(
            yield* Effect.forEach(queues, (queue) => {
              // The fixture's export decorator adds this typed RPC to the exact
              // production namespaces. Upstream erases export extension types.
              const observed =
                queue as unknown as Cloudflare.DurableObject<Observation.ObservedQueue>
              return observed.getByName("shared").observe()
            })
          )
        }
        return yield* application.fetch
      })
    }
  })
)
