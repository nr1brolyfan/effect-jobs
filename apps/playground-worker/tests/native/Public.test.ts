// @effect-diagnostics unstableApiUsage:off
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Test from "@alchemy.run/test/Bun"
import { Pool } from "pg"
import { migrations } from "../../src/persistence/MigrationRegistry.js"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { afterAll, expect } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import Stack from "./ApplicationStack.js"

const api = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  sidecar: { omitEnv: ["CLOUDFLARE_"] }
})
const pool = new Pool({
  connectionString: process.env.PG_connectionString,
  max: 2,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const ready = api.beforeAll(
  Effect.promise(async () => {
    await pool.query("SELECT 1")
    await pool.query('CREATE SCHEMA "native_application"')
    for (const migration of migrations("native_application")) {
      await pool.query(migration.sql)
    }
  })
)
const stack = api.beforeAll(Effect.andThen(ready, api.deploy(Stack)))
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
      "/jobs.html",
      "/api",
      "/api.html",
      "/demo.html",
      "/demo/foreign",
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
api.test(
  "publishes the real readonly demo after native generator and encrypted queue completion",
  Effect.gen(function* () {
    yield* stack
    const response = yield* HttpClient.get(process.env.ORIGIN! + "/api/demo").pipe(
      Effect.filterOrFail(
        (response) => response.status === 200,
        () => "native demo is not ready"
      ),
      Effect.retry({ times: 240, schedule: Schedule.spaced("250 millis") })
    )
    const view = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(SandboxView))
    )
    expect(Object.values(view.capabilities).every((enabled) => enabled === false)).toBe(
      true
    )
    const evidence = yield* Effect.promise(() =>
      pool.query(
        "SELECT count(*)::int AS n FROM native_application.jobs WHERE kind='playground.synthetic-document-export' AND queue='playground-private' AND state='Completed'"
      )
    )
    expect(evidence.rows[0].n).toBeGreaterThan(0)
  }),
  { timeout: 90000 }
)
api.afterAll(api.destroy(Stack))
queueMicrotask(() => afterAll(() => pool.end()))
