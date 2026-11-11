// @effect-diagnostics unstableApiUsage:off
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Test from "alchemy/Test/Bun"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import Stack from "./ApplicationStack.js"

const api = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  sidecar: { omitEnv: ["CLOUDFLARE_"] }
})
const stack = api.beforeAll(api.deploy(Stack))
api.test(
  "public mode cannot acquire private authority through paths or headers",
  Effect.gen(function* () {
    expect((yield* stack).url).toBeDefined()
    const base = process.env.ORIGIN!
    yield* HttpClient.get(base + "/native-ready").pipe(
      Effect.filterOrFail(
        (response) => response.status === 200,
        () => "native HTTP pending"
      ),
      Effect.retry({ times: 30, schedule: Schedule.spaced("100 millis") })
    )
    for (const path of [
      "/jobs",
      "/jobs/foreign",
      "/api/sandbox/issue",
      "/api/jobs",
      "/api/changes",
      "/api/demo/control"
    ]) {
      const response = yield* Effect.promise(() =>
        fetch(base + path, {
          headers: {
            "X-Local-Private": "true",
            LOCAL_PRIVATE: "true",
            "X-Forwarded-Host": new URL(base).host,
            Origin: base
          }
        })
      )
      expect(response.status).toBe(404)
    }
    const forbiddenWrite = yield* Effect.promise(() =>
      fetch(base + "/api/demo/jobs", { method: "POST", headers: { Origin: base } })
    )
    expect(forbiddenWrite.status).toBe(404)
  }),
  { timeout: 20000 }
)
api.afterAll(api.destroy(Stack))
