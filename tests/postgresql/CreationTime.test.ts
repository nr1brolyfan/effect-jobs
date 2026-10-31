/** Real disposable PG only. The foreground owner supplies fresh private config. */
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { Pool } from "../qualification/d6-pg/PgDriver.js"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import { define } from "../../src/FailureCode.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Tables from "../../src/PostgreSqlSchema.js"
import * as Jobs from "../../src/PostgreSqlJobs.js"
import {
  PostgreSqlApplication,
  PostgreSqlInvalidHandle
} from "../../src/PostgreSqlTransaction.js"
import * as App from "../qualification/d6-pg/ApplicationTransactions.js"
import * as Adapter from "./Adapter.js"

const code = define({ retry: "fixture_retry" }).retry
const config = process.env.CREATION_TIME_PRIVATE_CONFIG
describe.skipIf(config === undefined)("creation metadata on real PostgreSQL", () => {
  let pool: Pool
  let backend: Jobs.Backend
  let adapter: Adapter.FixtureAdapter
  const schema = "creation_" + randomUUID().replaceAll("-", "")
  const mapping = Tables.tables({
    schema,
    jobsTable: "tasks",
    payloadsTable: "artifacts"
  })
  const { jobs } = Tables.relations(mapping)
  const definition = Job.make({
    queue: Queue.make("creation"),
    kind: "fixture",
    payload: Schema.String
  })
  const policy = Policy.defaultPolicy
  const input = (operationId: string, availableAt?: number) => ({
    producer: { operation: "fixture", operationId, slot: "job" },
    policy,
    payload: "fixture",
    ...(availableAt === undefined ? {} : { availableAt })
  })
  const read = async (id: string) =>
    (await pool.query(`SELECT * FROM ${jobs} WHERE id=$1`, [id])).rows[0]
  const enqueue = (id: string, availableAt?: number) =>
    Effect.runPromise(
      backend.withTransaction((tx) =>
        definition.enqueueInTransaction(tx, input(id, availableAt))
      )
    )
  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(config!, "utf8"))
    pool = new Pool({
      host: "127.0.0.1",
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      max: 4
    })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    // A populated pre-change schema: retain real historical rows and all old bytes.
    await pool.query(Tables.migration(mapping).replace("  created_at bigint,\n", ""))
    await pool.query(
      `INSERT INTO ${jobs} (id,operation,operation_id,slot,queue,kind,version,policy,state,available_at,updated_at)
      VALUES ('legacy','fixture','legacy','job','creation','fixture',1,$1,'Pending',123,456)`,
      [policy]
    )
    adapter = Adapter.make(App.source(pool))
    backend = await Effect.runPromise(
      Jobs.make({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(
        Effect.provideService(PostgreSqlApplication, {
          ...adapter,
          ambient: Effect.flatMap(App.activeHandle, (handle) =>
            Option.isNone(handle)
              ? Effect.fail(new PostgreSqlInvalidHandle({ reason: "inactive-handle" }))
              : adapter.validate(handle.value)
          )
        })
      )
    )
  })
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await pool.end()
      }
    }
  })
  test("populated additive migration preserves old bytes, readiness rejects unmigrated storage", async () => {
    const before = await read("legacy")
    expect(Exit.isFailure(await Effect.runPromiseExit(backend.ready))).toBe(true)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(Tables.creationTimeMigration(mapping))
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
    expect(Exit.isFailure(await Effect.runPromiseExit(backend.ready))).toBe(true)
    await pool.query(Tables.creationTimeMigration(mapping))
    await Effect.runPromise(backend.ready)
    const { created_at, ...after } = await read("legacy")
    expect(created_at).toBeNull()
    expect(after).toEqual(before)
  })
  test("initial/delayed/duplicate/replayed receipt writes preserve the first DB insertion sample", async () => {
    const before = Number(
      (
        await pool.query(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n"
        )
      ).rows[0].n
    )
    const future = before + 3_600_000
    const first = await enqueue("delayed", future)
    const original = await read(first.jobId)
    const after = Number(
      (
        await pool.query(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n"
        )
      ).rows[0].n
    )
    expect(Number(original.created_at)).toBeGreaterThanOrEqual(before)
    expect(Number(original.created_at)).toBeLessThanOrEqual(after)
    expect(original.created_at).toBe(original.updated_at)
    expect(Number(original.available_at)).toBe(future)
    const duplicate = await enqueue("delayed", future + 1)
    expect(duplicate).toEqual({ _tag: "AlreadyPresent", jobId: first.jobId })
    expect(await read(first.jobId)).toEqual(original)
    await pool.query(
      `CREATE TABLE "${schema}".receipts (request text PRIMARY KEY, job_id text REFERENCES ${jobs}(id))`
    )
    await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, (tx) =>
          Effect.gen(function* () {
            const result = yield* definition.enqueueInTransaction(tx, input("receipt"))
            yield* handle.query(`INSERT INTO "${schema}".receipts VALUES ('one',$1)`, [
              result.jobId
            ])
          })
        )
      )
    )
    const receiptId = (
      await pool.query(`SELECT job_id FROM "${schema}".receipts WHERE request='one'`)
    ).rows[0].job_id
    const receiptJob = await read(receiptId)
    // Application receipt replay reads the original ID and job, with no new insertion.
    expect((await read(receiptId)).created_at).toBe(receiptJob.created_at)
    expect((await enqueue("receipt")).jobId).toBe(receiptId)
    expect(await read(receiptId)).toEqual(receiptJob)
    const immediate = await enqueue("immediate")
    const row = await read(immediate.jobId)
    expect(row.created_at).toBe(row.available_at)
  })
  test("rollback removes timestamp/payload/job/receipt atomically and typed conflict stays unchanged", async () => {
    const failed = await Effect.runPromiseExit(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, (tx) =>
          Effect.gen(function* () {
            const row = yield* definition.enqueueInTransaction(tx, input("rollback"))
            yield* handle.query(
              `INSERT INTO "${schema}".receipts VALUES ('rollback',$1)`,
              [row.jobId]
            )
            return yield* Effect.fail("business-failure")
          })
        )
      )
    )
    expect(Exit.isFailure(failed)).toBe(true)
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM ${jobs} WHERE operation_id='rollback'`
        )
      ).rows[0].n
    ).toBe(0)
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "${schema}".receipts WHERE request='rollback'`
        )
      ).rows[0].n
    ).toBe(0)
    const result = await Effect.runPromiseExit(
      backend.withTransaction((tx) =>
        definition.enqueueInTransaction(tx, {
          ...input("delayed"),
          payload: "changed"
        })
      )
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(Cause.findErrorOption(result.cause)).toMatchObject({
        value: { _tag: "JobIntegrityConflict" }
      })
    }
  })
  test("claim/release/recovery/finalize/retry-now/cancel never rewrite created_at", async () => {
    const inserted = await enqueue("lifecycle")
    const original = (await read(inserted.jobId)).created_at
    const request = () => ({
      queue: "creation",
      supportedCatalog: [definition.catalog],
      leaseToken: randomUUID()
    })
    const claim = async () => {
      const result = await Effect.runPromise(backend.store.claim(request()))
      expect(result._tag).toBe("Claimed")
      if (result._tag !== "Claimed") {
        throw new Error("expected claim")
      }
      expect(result.claim.snapshot.createdAt).toBe(Number(original))
      return result.claim
    }
    // Exclude other fixture jobs from this worker selection without altering creation metadata.
    await pool.query(`UPDATE ${jobs} SET available_at=253402300799999 WHERE id<>$1`, [
      inserted.jobId
    ])
    const first = await claim()
    await Effect.runPromise(backend.store.release(first.ownership, "BeforeExecution"))
    expect((await read(inserted.jobId)).created_at).toBe(original)
    const second = await claim()
    await Effect.runPromise(
      backend.store.finalize({
        before: second.snapshot,
        ownership: second.ownership,
        finalization: { _tag: "Retry", code }
      })
    )
    const retry = await read(inserted.jobId)
    expect(retry.created_at).toBe(original)
    await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, () =>
          backend.operators.retryNow({
            jobId: inserted.jobId,
            state: "RetryScheduled",
            lifecycleVersion: Number(retry.lifecycle_version)
          })
        )
      )
    )
    const third = await claim()
    await pool.query(`UPDATE ${jobs} SET lease_expires_at=1 WHERE id=$1`, [
      inserted.jobId
    ])
    await Effect.runPromise(backend.store.recoverExpired(10))
    expect((await read(inserted.jobId)).created_at).toBe(original)
    const recovered = await read(inserted.jobId)
    await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, () =>
          backend.operators.cancel({
            jobId: inserted.jobId,
            state: "Pending",
            lifecycleVersion: Number(recovered.lifecycle_version)
          })
        )
      )
    )
    expect((await read(third.snapshot.jobId)).created_at).toBe(original)
  })
  test.each(["Redrive", "CorrectedRedrive"] as const)(
    "%s stamps a new successor and preserves its source",
    async (kind) => {
      const first = await enqueue(kind)
      await pool.query(
        `UPDATE ${jobs} SET state='Dead',completed_at=updated_at,attempts_made=3 WHERE id=$1`,
        [first.jobId]
      )
      const source = await read(first.jobId)
      const expected = { jobId: first.jobId, state: "Dead" as const, lifecycleVersion: 0 }
      const producer = input(kind + "-successor").producer
      const successor = await Effect.runPromise(
        adapter.applicationTransaction((handle) =>
          backend.joinTransaction(handle, () =>
            kind === "Redrive"
              ? backend.operators.redrive(definition, { expected, producer })
              : backend.operators.correctedRedrive(definition, {
                  expected,
                  producer,
                  payload: "corrected"
                })
          )
        )
      )
      const row = await read(successor.jobId)
      expect(row.id).not.toBe(first.jobId)
      expect(Number(row.created_at)).toBe(successor.dbNow)
      expect(Number(row.created_at)).toBeGreaterThanOrEqual(Number(source.created_at))
      const replay = await Effect.runPromise(
        adapter.applicationTransaction((handle) =>
          backend.joinTransaction(handle, () =>
            kind === "Redrive"
              ? backend.operators.redrive(definition, { expected, producer })
              : backend.operators.correctedRedrive(definition, {
                  expected,
                  producer,
                  payload: "corrected"
                })
          )
        )
      )
      expect(replay.jobId).toBe(successor.jobId)
      expect(replay.inserted).toBe(false)
      expect(await read(successor.jobId)).toEqual(row)
      expect(await read(first.jobId)).toEqual(source)
    }
  )
})
