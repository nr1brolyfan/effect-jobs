import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Test from "@alchemy.run/test/Bun"
import { afterAll, expect } from "bun:test"
import { Effect } from "effect"
import { Pool } from "pg"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { migrations } from "../../src/persistence/MigrationRegistry.js"
import Stack from "./ObservationStack.js"
import * as Observation from "./QueueObservation.js"
import * as Client from "./ObservationClient.js"

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
const snapshots: Record<string, ReadonlyArray<Observation.Observation>> = {}
const read = () => Client.read(origin)
const until = async (
  predicate: (rows: ReadonlyArray<Observation.Observation>) => boolean
) => {
  const deadline = Date.now() + 18000
  while (true) {
    const rows = await read()
    if (predicate(rows)) {
      return rows
    }
    if (Date.now() >= deadline) {
      throw new Error("Native queue observation deadline")
    }
    await Bun.sleep(100)
  }
}

api.test(
  "observes production queue activation, native deliveries, retries and retirement cancellation",
  Effect.gen(function* () {
    const output = yield* stack
    expect(new URL(output.url!).port).toBe(new URL(origin).port)
    expect(output.namespaces).toEqual([
      "Commerce",
      "Communications",
      "DemoGenerator",
      "Gateway",
      "Media",
      "Private",
      "SandboxLive"
    ])
    yield* Effect.promise(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          if (
            (await fetch(origin + "/native-ready", { signal: AbortSignal.timeout(1000) }))
              .status === 200
          ) {
            break
          }
        } catch {
          /* bounded native readiness */
        }
        if (attempt === 49) {
          throw new Error("Native readiness deadline")
        }
        await Bun.sleep(100)
      }
      snapshots.initial = await read()
      expect(snapshots.initial.map((row) => row.name)).toEqual([...Observation.names])
      expect(
        snapshots.initial.every(
          (row) =>
            row.calls === 0 &&
            row.activations === 0 &&
            row.alarm === null &&
            row.scheduledAt === null
        )
      ).toBe(true)
      const issued = await fetch(origin + "/api/sandbox/issue", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" }
      })
      expect(issued.status).toBe(200)
      const cookies = issued.headers.getSetCookie()
      const cookie = cookies.map((value) => value.split(";")[0]).join("; ")
      const token = cookies
        .find((value) => value.startsWith(Cookies.names(origin, true).csrf + "="))!
        .split(";")[0]!
        .split("=")[1]!
      const describe = () =>
        fetch(origin + "/api/sandbox", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-Playground-CSRF": token
          }
        })
      expect((await describe()).status).toBe(200)
      // Prevent automatic arrivals; the genuine five-second maintenance remains on.
      await pool.query(
        "UPDATE native_application.sandboxes SET next_generation_at=expires_at"
      )
      snapshots.active = await until((rows) =>
        rows.every(
          (row) =>
            row.activations > 0 &&
            row.calls > 0 &&
            (row.progress ?? 0) > 0 &&
            row.alarm !== null &&
            row.scheduledAt !== null
        )
      )
      expect(snapshots.active.every((row) => !row.parked && row.failures === 0)).toBe(
        true
      )

      // A missing fixture-owned relation causes the actual production SQL path to
      // fail. Alchemy, rather than a synthetic handler, schedules the retry.
      await pool.query(
        "ALTER TABLE native_application.jobs RENAME TO jobs_observation_unavailable"
      )
      try {
        snapshots.retry = await until((rows) =>
          rows.every(
            (row) =>
              row.failures > 0 &&
              row.attempts > 0 &&
              row.retryAt !== null &&
              row.alarm !== null
          )
        )
      } finally {
        await pool.query(
          "ALTER TABLE native_application.jobs_observation_unavailable RENAME TO jobs"
        )
      }
      snapshots.recovered = await until((rows) =>
        rows.every(
          (row, index) =>
            row.calls > snapshots.retry![index]!.calls &&
            (row.progress ?? 0) > (snapshots.active![index]!.progress ?? 0)
        )
      )
      expect(
        snapshots.recovered.every(
          (row) => row.alarm !== null && row.scheduledAt !== null && !row.parked
        )
      ).toBe(true)
      await pool.query("UPDATE native_application.sandboxes SET viewer_until=1")
      snapshots.retired = await until((rows) =>
        rows.every((row) => row.alarm === null && row.scheduledAt === null)
      )
      expect(
        snapshots.retired.every(
          (row, index) => row.calls > snapshots.recovered![index]!.calls
        )
      ).toBe(true)
      await Bun.sleep(1200)
      expect(await read()).toEqual(snapshots.retired)
      expect((await describe()).status).toBe(200)
      snapshots.resumed = await until((rows) =>
        rows.every(
          (row, index) =>
            row.activations > snapshots.retired![index]!.activations &&
            row.alarm !== null &&
            row.scheduledAt !== null
        )
      )
      await pool.query("UPDATE native_application.sandboxes SET viewer_until=1")
      await until((rows) =>
        rows.every((row) => row.alarm === null && row.scheduledAt === null)
      )
      await Bun.write(
        process.env.NATIVE_EVIDENCE_DIRECTORY! + "/observations.json",
        JSON.stringify(snapshots, null, 2)
      )
    })
  }),
  { timeout: 90000 }
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
