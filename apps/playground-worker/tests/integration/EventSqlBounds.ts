// @effect-diagnostics unstableApiUsage:off
// Qualifies the owner-selected native SQL API pinned to Effect 4.1.0.
// Real-PG qualification FFI. The launcher supplies a fresh disposable database.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Pool } from "pg"
import { Cause, Effect, Exit, Schema, Scope } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Event from "../../src/execution/Event.js"
import * as Migrations from "../../src/persistence/MigrationRegistry.js"
import { definitions } from "../scenarios/Setup.js"

const Configuration = Schema.Struct({
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
  port: Schema.Int,
  schema: Schema.String,
  encryptionKey: Schema.String,
  fingerprintKey: Schema.String,
  cursorKey: Schema.String
})
const cfg = Schema.decodeUnknownSync(Configuration)(
  JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG!, "utf8"))
)
const connectionString = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const admin = new Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000
})
const pids = new Set<number>()
const checks: Array<{ name: string; millis: number }> = []
const run = <A, E>(body: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    Event.run(
      { ...cfg, connectionString },
      Effect.void,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const rows = yield* sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`
        pids.add(rows[0]!.pid)
        return yield* body
      }),
      definitions
    )
  )
const failure = <A, E>(exit: Exit.Exit<A, E>) => {
  assert(Exit.isFailure(exit), "Expected a real SQL failure")
  assert(Cause.hasFails(exit.cause), "Expected the typed SQL error channel")
}
const bounded = async (name: string, body: () => Promise<void>, minimum = 0) => {
  const start = performance.now()
  await body()
  const millis = performance.now() - start
  assert(millis >= minimum && millis < 9000, `${name}: finite local contract`)
  checks.push({ name, millis })
}
try {
  await admin.query(`CREATE SCHEMA "${cfg.schema}"`)
  for (const migration of Migrations.migrations(cfg.schema)) {
    await admin.query(migration.sql)
  }
  await admin.query(`CREATE TABLE "${cfg.schema}".bounds_parent (id integer PRIMARY KEY)`)
  await admin.query(`INSERT INTO "${cfg.schema}".bounds_parent VALUES (1)`)
  await admin.query(
    `CREATE TABLE "${cfg.schema}".bounds_child (id integer REFERENCES "${cfg.schema}".bounds_parent DEFERRABLE INITIALLY DEFERRED)`
  )
  await bounded(
    "active startup settings and successful native BEGIN/COMMIT/release",
    async () => {
      await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          const settings = yield* sql<{ statement: string; lock: string; idle: string }>`
        SELECT current_setting('statement_timeout') AS statement,
          current_setting('lock_timeout') AS lock,
          current_setting('idle_in_transaction_session_timeout') AS idle`
          assert.deepEqual(settings, [{ statement: "2s", lock: "1s", idle: "5s" }])
          yield* sql.withTransaction(sql`SELECT 1`)
        })
      )
    }
  )
  await bounded(
    "raw statement timeout and native ROLLBACK",
    async () => {
      await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          let bodies = 0
          const exit = yield* Effect.exit(
            sql.withTransaction(
              Effect.gen(function* () {
                bodies++
                yield* sql`SELECT pg_sleep(10)`
              })
            )
          )
          failure(exit)
          assert.equal(bodies, 1, "No transaction replay")
          assert.equal((yield* sql<{ value: number }>`SELECT 1 AS value`)[0]!.value, 1)
        })
      )
    },
    1800
  )
  const locker = await admin.connect()
  try {
    await locker.query("BEGIN")
    await locker.query(`UPDATE "${cfg.schema}".bounds_parent SET id = 2 WHERE id = 1`)
    await bounded(
      "raw row lock timeout outside Native adapter",
      async () => {
        await run(
          Effect.gen(function* () {
            const sql = yield* SqlClient
            failure(
              yield* Effect.exit(
                sql.unsafe(`SELECT * FROM "${cfg.schema}".bounds_parent FOR UPDATE`)
              )
            )
          })
        )
      },
      800
    )
    await bounded(
      "actual deferred-constraint COMMIT lock failure without replay",
      async () => {
        await run(
          Effect.gen(function* () {
            const sql = yield* SqlClient
            let bodies = 0
            const exit = yield* Effect.exit(
              sql.withTransaction(
                Effect.gen(function* () {
                  bodies++
                  yield* sql.unsafe(`INSERT INTO "${cfg.schema}".bounds_child VALUES (1)`)
                })
              )
            )
            failure(exit)
            assert.equal(bodies, 1)
          })
        )
      },
      800
    )
  } finally {
    await locker.query("ROLLBACK")
    locker.release()
  }
  assert.equal(
    (await admin.query(`SELECT count(*)::int AS count FROM "${cfg.schema}".bounds_child`))
      .rows[0].count,
    0
  )
  await bounded(
    "finite native acquisition with both event connections reserved",
    async () => {
      await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          const scope = yield* Scope.make()
          yield* Effect.acquireUseRelease(
            Effect.succeed(scope),
            () =>
              Effect.gen(function* () {
                yield* sql.reserve.pipe(Scope.provide(scope))
                yield* sql.reserve.pipe(Scope.provide(scope))
                failure(yield* Effect.exit(sql`SELECT 1`))
              }),
            (scope) => Scope.close(scope, Exit.void)
          )
          yield* sql`SELECT 1`
        })
      )
    },
    1800
  )
  await bounded(
    "idle native transaction is terminated, rollback/release finish",
    async () => {
      await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          let bodies = 0
          const exit = yield* Effect.exit(
            sql.withTransaction(
              Effect.gen(function* () {
                bodies++
                yield* sql`SELECT 1`
                yield* Effect.sleep("5100 millis")
                yield* sql`SELECT 1`
              })
            )
          )
          assert(Exit.isFailure(exit))
          assert(
            Cause.hasDies(exit.cause),
            "Pinned native rollback failure remains a defect in the complete Cause"
          )
          assert.equal(bodies, 1)
        })
      )
    },
    5000
  )
  const sessions = await admin.query(
    "SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[])",
    [[...pids]]
  )
  assert.equal(sessions.rowCount, 0, "Event Scope closes its actual sessions")
  writeFileSync(
    `${process.env.PLAYGROUND_EVIDENCE_DIRECTORY}/sql-bounds.json`,
    JSON.stringify(
      { checks, eventSessionsAbsent: true, networkBlackhole: "NotTested; no guarantee" },
      null,
      2
    )
  )
  console.log(JSON.stringify({ checks, eventSessionsAbsent: true }))
} finally {
  await admin.end()
}
