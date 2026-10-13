import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { Application } from "../../../website/src/server/Services.js"
import { Repairs } from "@effect-jobs/playground-contracts/Repairs"
import * as Http from "../../../website/src/server/HttpApplication.js"
import { LocalPrivate } from "../../src/persistence/authority/PrivateMode.js"

// Every unimplemented service operation fails loudly if disabled admission calls it.
describe("trusted private admission", () => {
  for (const origin of ["http://localhost:9123", "http://127.0.0.1:9123"]) {
    it(`denies all private APIs with forged hints at ${origin}`, async () => {
      for (const enabled of [undefined, false]) {
        for (const path of [
          "/api/sandbox/issue",
          "/api/sandbox",
          "/api/jobs/detail",
          "/api/jobs/problems",
          "/api/jobs/history",
          "/api/jobs/related",
          "/api/jobs/operator",
          "/api/jobs/repair",
          "/api/jobs/repair/receipt",
          "/api/jobs/resolution",
          "/api/jobs/resolution/receipt",
          "/api/scenarios",
          "/api/sandbox/reset"
        ]) {
          const request = new Request(origin + path, {
            method: "POST",
            headers: {
              Origin: origin,
              Host: "localhost:9123",
              "Content-Type": "application/json",
              "X-Local-Private": "true",
              Cookie: "playground-local-credential=forged"
            },
            body: '{"trusted":true}'
          })
          const response = await Effect.runPromise(
            Http.handle(request, "http://127.0.0.1:9123", () => true, true).pipe(
              Effect.provideService(LocalPrivate, enabled === true),
              Effect.provide(
                Layer.mock(Application, {
                  repairs: Effect.runSync(
                    Effect.service(Repairs).pipe(Effect.provide(Layer.mock(Repairs, {})))
                  )
                })
              )
            )
          )
          expect(response.status).toBe(404)
          expect(await response.json()).toEqual({ code: "not-found" })
        }
      }
    })
  }
})
