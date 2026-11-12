import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Test from "@alchemy.run/test/Bun"
import { afterAll, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Pool } from "pg"
import WebSocket from "ws"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { JobPage } from "@effect-jobs/playground-contracts/Jobs"
import { Signal } from "@effect-jobs/playground-contracts/LiveProtocol"
import { migrations } from "../../src/persistence/MigrationRegistry.js"
import Stack from "../../alchemy.run.js"

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
    await pool.query('CREATE SCHEMA "native_application"')
    for (const migration of migrations("native_application")) {
      await pool.query(migration.sql)
    }
  })
)
const stack = api.beforeAll(Effect.andThen(ready, api.deploy(Stack)))
const origin = process.env.ORIGIN!
const get = (path: string) => fetch(origin + path, { signal: AbortSignal.timeout(5000) })

api.test(
  "serves parallel HTTP and WebSocket admission without blocking later native requests",
  Effect.gen(function* () {
    const output = yield* stack
    expect(new URL(output.url!).port).toBe(new URL(origin).port)
    yield* Effect.promise(async () => {
      const deadline = Date.now() + 30000
      let response: Response
      while (true) {
        response = await get("/api/demo")
        if (response.status === 200) {
          break
        }
        if (Date.now() >= deadline) {
          throw new Error("Native demo readiness deadline")
        }
        await Bun.sleep(200)
      }
      const demo = Schema.decodeUnknownSync(SandboxView)(await response.json())
      const parallel = await Promise.all([get("/api/demo"), get("/api/demo")])
      expect(parallel.map((value) => value.status)).toEqual([200, 200])
      for (const value of parallel) {
        expect(Schema.decodeUnknownSync(SandboxView)(await value.json()).ref).toEqual(
          demo.ref
        )
      }
      const socket = new WebSocket(origin.replace("http:", "ws:") + "/api/demo/changes", {
        headers: { Origin: origin }
      })
      try {
        const signal = new Promise<Signal>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Native concurrent WebSocket deadline")),
            5000
          )
          socket.once("message", (message) => {
            clearTimeout(timer)
            try {
              const bytes = Array.isArray(message)
                ? Buffer.concat(message)
                : message instanceof ArrayBuffer
                  ? Buffer.from(message)
                  : message
              resolve(
                Schema.decodeUnknownSync(Signal)(JSON.parse(bytes.toString("utf8")))
              )
            } catch (error) {
              reject(error)
            }
          })
          socket.once("error", (error) => {
            clearTimeout(timer)
            reject(error)
          })
          socket.once("unexpected-response", (_request, value) => {
            clearTimeout(timer)
            value.resume()
            reject(new Error("Native concurrent upgrade rejected"))
          })
        })
        const [first, description] = await Promise.all([signal, get("/api/demo")])
        expect(first.kind).toBe("ready")
        expect(description.status).toBe(200)
        await description.arrayBuffer()
        expect((await get("/api/demo")).status).toBe(200)
        const query = new URLSearchParams({
          sandboxId: demo.ref.sandboxId,
          generation: String(demo.ref.generation),
          limit: "20"
        })
        const jobs = await get("/api/demo/jobs?" + query)
        expect(jobs.status).toBe(200)
        const page = Schema.decodeUnknownSync(JobPage)(await jobs.json())
        expect(page.items.length).toBe(20)
        expect(page.nextCursor).toBeDefined()
      } finally {
        socket.terminate()
      }
    })
  }),
  { timeout: 60000 }
)

api.afterAll(
  api.destroy(Stack).pipe(
    Effect.andThen(
      Effect.promise(async () => {
        const active = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
        )
        expect(active.rows[0].n).toBe(0)
      })
    )
  )
)
queueMicrotask(() => afterAll(() => pool.end()))
