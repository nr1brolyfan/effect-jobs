import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes, randomUUID } from "node:crypto"
import { Effect, Exit, Duration, Schema, Deferred, Fiber, Layer } from "effect"
import type { PoolConfig } from "pg"
import { Pool } from "../qualification/d6-pg/PgDriver.js"
import { beforeAll, afterAll, describe, expect, test } from "vitest"
import * as Job from "../../src/Job.js"
import * as Queue from "../../src/JobQueue.js"
import * as Producer from "../../src/JobProducer.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Jobs from "../../src/PostgreSqlJobs.js"
import * as Tables from "../../src/PostgreSqlSchema.js"
import {
  PostgreSqlApplication,
  PostgreSqlFailure
} from "../../src/PostgreSqlTransaction.js"
import type { ApplicationAdapter } from "../../src/PostgreSqlTransaction.js"
import * as Payload from "../../src/JobPayload.js"
import { encodeJobPayload, decodeJobPayload } from "../../src/JobPayloadCodec.js"
import * as Registry from "../../src/JobRegistry.js"
import * as Consumer from "../../src/JobConsumer.js"
import * as Worker from "../../src/JobWorker.js"
import { drain } from "../../src/JobWorkerRuntime.js"
import { JobFailures, type JobFailure } from "../../src/JobFailure.js"
import type { HandlerInput } from "../../src/JobContract.js"
import { readQualificationResource } from "../qualification/Resource.mjs"
import type { ClaimedJob } from "../../src/JobStore.js"
import type { JobsTransaction } from "../../src/JobTransaction.js"
import * as App from "../qualification/d6-pg/ApplicationTransactions.js"
import * as Adapter from "./Adapter.js"

const directory = process.env.D6_RESOURCE_DIRECTORY
const definition = Job.make({
  kind: "invoice.generate",
  version: 1,
  queue: Queue.make("billing"),
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: encodeJobPayload
})
const producer = Producer.make({ operation: "billing.issue", slots: ["generate"] })
const policy = Policy.make({
  completedRetention: Duration.millis(1),
  deadRetention: Duration.millis(1)
})
const input = (id: string, value = id, configured = policy, availableAt?: number) => ({
  producer: producer.identity({ operationId: id, slot: "generate" }),
  payload: { invoiceId: value },
  policy: configured,
  ...(availableAt === undefined ? {} : { availableAt })
})
const mapping = Tables.tables({
  schema: "backend_fixture",
  jobsTable: "tasks",
  payloadsTable: "task_artifacts"
})
const request = (token = randomUUID()) => ({
  queue: "billing",
  supportedCatalog: [definition.catalog],
  leaseToken: token
})

describe.skipIf(directory === undefined)("production PostgreSQL backend", () => {
  let admin: Pool
  let pool: Pool
  let observer: Pool
  let source: App.Source
  let adapter: Adapter.FixtureAdapter
  let backend: Jobs.Backend
  let schemaCreated = false
  let roleCreated = false
  let tempRemoved = false
  let version = ""
  const boundaries: Array<{
    operation: string
    expiry: number
    dbNow: number
    delta: number
  }> = []
  const role = "backend_fixture_runtime"
  const make = (integration: ApplicationAdapter) =>
    Effect.runPromise(
      Jobs.make({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(
        Effect.provideService(PostgreSqlApplication, integration)
      )
    )
  beforeAll(async () => {
    const env = Object.fromEntries(
      readFileSync(`${directory}/postgres.env`, "utf8")
        .split("\n")
        .filter((s) => s.includes("="))
        .map((s) => {
          const i = s.indexOf("=")
          return [s.slice(0, i), s.slice(i + 1)]
        })
    )
    const ownership = readQualificationResource(`${directory}`)
    expect(new Date().getTime()).toBeLessThan(Date.parse(ownership.deadline) - 60000)
    expect(env.POSTGRES_DB).toBe("effect_jobs_d6")
    const config: PoolConfig = {
      host: "127.0.0.1",
      port: Number(ownership.ports["5432/tcp"][0].HostPort),
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      max: 4,
      connectionTimeoutMillis: 500,
      statement_timeout: 2000,
      query_timeout: 3000,
      idleTimeoutMillis: 1000
    }
    admin = new Pool(config)
    version = (await admin.query("SHOW server_version")).rows[0].server_version
    const secret = randomBytes(24).toString("hex")
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    )
    roleCreated = true
    const granted = (
      await admin.query(
        `SELECT EXISTS (SELECT 1 FROM pg_database d,LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='TEMPORARY') AS granted`
      )
    ).rows[0].granted
    if (granted) {
      await admin.query("REVOKE TEMPORARY ON DATABASE effect_jobs_d6 FROM PUBLIC")
      tempRemoved = true
    }
    await admin.query("CREATE SCHEMA backend_fixture")
    schemaCreated = true
    await admin.query(Tables.migration(mapping))
    await admin.query(`CREATE TABLE backend_fixture.invoices (id text PRIMARY KEY CHECK (id <> 'fail-invoice'));
      ALTER TABLE backend_fixture.tasks ADD CHECK (operation_id <> 'fail-job');
      ALTER TABLE backend_fixture.task_artifacts ADD CHECK (position(convert_to('fail-payload','UTF8') in payload)=0);
      CREATE TABLE backend_fixture.receipts (id text PRIMARY KEY REFERENCES backend_fixture.invoices(id),job_id text NOT NULL REFERENCES backend_fixture.tasks(id),CHECK (id <> 'fail-receipt'));
      GRANT CONNECT ON DATABASE effect_jobs_d6 TO ${role}; GRANT USAGE ON SCHEMA backend_fixture TO ${role};
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA backend_fixture TO ${role}`)
    pool = new Pool({ ...config, user: role, password: secret })
    observer = new Pool({ ...config, user: role, password: secret })
    source = App.source(pool)
    adapter = Adapter.make(source)
    backend = await make(adapter)
  }, 30000)
  afterAll(async () => {
    await pool?.end()
    await observer?.end()
    if (admin !== undefined) {
      try {
        if (schemaCreated) {
          await admin.query("DROP SCHEMA backend_fixture CASCADE")
        }
        if (roleCreated) {
          await admin.query(`DROP OWNED BY ${role}`)
          await admin.query(`DROP ROLE ${role}`)
        }
        if (tempRemoved) {
          await admin.query("GRANT TEMPORARY ON DATABASE effect_jobs_d6 TO PUBLIC")
        }
        const cleanup = (
          await admin.query(
            "SELECT (SELECT count(*)::int FROM pg_namespace WHERE nspname='backend_fixture') AS schemas,(SELECT count(*)::int FROM pg_roles WHERE rolname='backend_fixture_runtime') AS roles"
          )
        ).rows[0]
        expect(cleanup).toEqual({ schemas: 0, roles: 0 })
        expect(
          source?.counters.sql.filter((s) =>
            /^(CREATE|ALTER|DROP|TRUNCATE|SAVEPOINT)/.test(s)
          )
        ).toHaveLength(0)
        if (process.env.PG_EVIDENCE_FILE) {
          writeFileSync(
            process.env.PG_EVIDENCE_FILE,
            JSON.stringify(
              {
                runtime: process.versions.bun === undefined ? "node" : "bun",
                runtimeVersion: process.versions.bun ?? process.version,
                serverVersion: version,
                driver: "8.23.0",
                borrows: source?.counters.borrows,
                sql: source?.counters.sql.length,
                ddl: source?.counters.sql.filter((s) =>
                  /^(CREATE|ALTER|DROP|TRUNCATE)/.test(s)
                ).length,
                savepoints: source?.counters.sql.filter((s) => s.startsWith("SAVEPOINT"))
                  .length,
                cleanup,
                tempRestored: tempRemoved,
                boundaries
              },
              null,
              2
            ) + "\n"
          )
        }
      } finally {
        await admin.end()
      }
    }
  }, 30000)
  const enqueue = (id: string, value = id, configured = policy, at?: number) =>
    Effect.runPromise(
      backend.withTransaction((tx) =>
        definition.enqueue(tx, input(id, value, configured, at))
      )
    )
  const row = async (id: string) =>
    (
      await observer.query("SELECT * FROM backend_fixture.tasks WHERE operation_id=$1", [
        id
      ])
    ).rows[0]
  const claim = async (): Promise<ClaimedJob> => {
    const result = await Effect.runPromise(backend.store.claim(request()))
    expect(result._tag).toBe("Claimed")
    if (result._tag !== "Claimed") {
      throw new Error("expected claim")
    }
    return result.claim
  }
  const finish = (
    claimed: ClaimedJob,
    finalization:
      | { readonly _tag: "Complete" }
      | { readonly _tag: "Retry"; readonly code: string; readonly notAfter?: number } = {
      _tag: "Complete"
    }
  ) =>
    Effect.runPromise(
      backend.store.finalize({
        ownership: claimed.ownership,
        before: claimed.snapshot,
        finalization
      })
    )
  const runWorker = (
    execute: (
      input: HandlerInput<{ readonly invoiceId: string }>
    ) => Effect.Effect<void, JobFailure>
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(definition.handlerLayer(execute, decodeJobPayload))
          const worker = yield* Worker.make(backend.store, {
            catalog: [definition],
            operationResponseBudgetMillis: 100
          })
          const consumer = yield* Consumer.make(definition.queue, {
            localConcurrency: 1,
            claimLimitPerRun: 1,
            recoveryLimitPerRun: 1
          })
          return yield* drain(consumer).pipe(
            Effect.provideService(Worker.JobWorker, worker)
          )
        }).pipe(Effect.provide(Registry.layer))
      )
    )
  const clear = async () => {
    await observer.query("DELETE FROM backend_fixture.receipts")
    await observer.query("DELETE FROM backend_fixture.invoices")
    await observer.query("DELETE FROM backend_fixture.tasks")
  }
  const serverNow = async () =>
    Number(
      (
        await observer.query(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
        )
      ).rows[0].now
    )

  test("actual pinned runtime/server and no runtime DDL, savepoint or pool ownership", async () => {
    expect(version.split(" ")[0]).toBe("16.15")
    expect(process.versions.bun === undefined ? "node" : "bun").toBe(
      process.env.PG_EXPECT_RUNTIME
    )
    expect(process.versions.bun ?? process.version).toBe(
      process.versions.bun === undefined ? "v24.15.0" : "1.4.2"
    )
    expect(
      JSON.parse(
        readFileSync(new URL("./node_modules/pg/package.json", import.meta.url), "utf8")
      ).version
    ).toBe("8.23.0")
    const before = source.counters.borrows
    await make(adapter)
    expect(source.counters.borrows).toBe(before)
    expect(
      source.counters.sql.some((s) => /^(CREATE|ALTER|DROP|TRUNCATE|SAVEPOINT)/.test(s))
    ).toBe(false)
    expect((await pool.query("SELECT 1 AS n")).rows[0].n).toBe(1)
    for (const sql of [
      "CREATE TABLE backend_fixture.denied (id int)",
      "CREATE TEMP TABLE denied (id int)",
      "TRUNCATE backend_fixture.tasks"
    ]) {
      await expect(pool.query(sql)).rejects.toMatchObject({ code: "42501" })
    }
  })
  test("neutral invoice, actual definition/payload and receipt commit atomically", async () => {
    await clear()
    const result = await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* handle.query("INSERT INTO backend_fixture.invoices(id) VALUES ($1)", [
              "atomic"
            ])
            const produced = yield* definition.enqueue(tx, input("atomic"))
            yield* handle.query(
              "INSERT INTO backend_fixture.receipts(id,job_id) VALUES ($1,$2)",
              ["atomic", produced.jobId]
            )
            return produced
          })
        )
      )
    )
    expect((await row("atomic")).id).toBe(result.jobId)
    const stored = (
      await observer.query(
        "SELECT * FROM backend_fixture.task_artifacts WHERE job_id=$1",
        [result.jobId]
      )
    ).rows[0]
    expect(new TextDecoder().decode(stored.payload)).toBe('{"invoiceId":"atomic"}')
    expect(
      (await observer.query("SELECT count(*)::int AS n FROM backend_fixture.receipts"))
        .rows[0].n
    ).toBe(1)
  })
  test("installed neutral transaction through worker retry, unknown recovery, completion and bounded cleanup", async () => {
    await clear()
    const id = "pipeline"
    const produced = await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* handle.query("INSERT INTO backend_fixture.invoices(id) VALUES ($1)", [
              id
            ])
            const result = yield* definition.enqueue(tx, input(id))
            yield* handle.query(
              "INSERT INTO backend_fixture.receipts(id,job_id) VALUES ($1,$2)",
              [id, result.jobId]
            )
            return result
          })
        )
      )
    )
    const seen: Array<number> = []
    const execute = (value: HandlerInput<{ readonly invoiceId: string }>) =>
      Effect.suspend((): Effect.Effect<void, JobFailure> => {
        expect(value.payload.invoiceId).toBe(id)
        expect(value.context.jobId).toBe(produced.jobId)
        seen.push(value.context.attemptNumber)
        if (seen.length === 1) {
          return Effect.fail(JobFailures.Retry({ code: "temporary" }))
        }
        if (seen.length === 2) {
          return Effect.fail(JobFailures.OutcomeUnknown({ code: "response_lost" }))
        }
        return Effect.void
      })
    await runWorker(execute)
    const retry = await row(id)
    expect(retry.state).toBe("RetryScheduled")
    expect(Number(retry.available_at) - Number(retry.updated_at)).toBe(5000)
    await observer.query("UPDATE backend_fixture.tasks SET available_at=1 WHERE id=$1", [
      produced.jobId
    ])
    await runWorker(execute)
    expect(await row(id)).toMatchObject({ state: "Active" })
    expect(Number((await row(id)).attempts_made)).toBe(1)
    await observer.query(
      "UPDATE backend_fixture.tasks SET lease_expires_at=1 WHERE id=$1",
      [produced.jobId]
    )
    expect(await Effect.runPromise(backend.store.recoverExpired(1))).toBe(1)
    await observer.query("UPDATE backend_fixture.tasks SET available_at=1 WHERE id=$1", [
      produced.jobId
    ])
    await runWorker(execute)
    expect(seen).toEqual([1, 2, 2])
    expect(await row(id)).toMatchObject({ state: "Completed" })
    expect(Number((await row(id)).attempts_made)).toBe(2)
    expect(Number((await row(id)).stalled_count)).toBe(1)
    // Application owns removal of its receipt before selecting generic cleanup.
    await observer.query("DELETE FROM backend_fixture.receipts WHERE id=$1", [id])
    expect(await Effect.runPromise(backend.cleanup.cleanup(1))).toBe(1)
    expect(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM backend_fixture.task_artifacts WHERE job_id=$1",
          [produced.jobId]
        )
      ).rows[0].n
    ).toBe(0)
  })
  test("explicit readiness validates relations/constraints/indexes; missing mapping fails finitely without DDL", async () => {
    await Effect.runPromise(backend.ready)
    const missing = await Effect.runPromise(
      Jobs.make({
        ...mapping,
        jobsTable: "absent",
        operationResponseBudgetMillis: 100
      }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
    )
    await expect(Effect.runPromise(missing.ready)).rejects.toMatchObject({
      _tag: "PostgreSqlFailure",
      commitKnowledge: "NotCommitted"
    })
    const name = Tables.indexPrefix(mapping) + "_due"
    await admin.query(`DROP INDEX backend_fixture."${name}"`)
    try {
      await expect(Effect.runPromise(backend.ready)).rejects.toMatchObject({
        _tag: "PostgreSqlFailure"
      })
    } finally {
      await admin.query(
        `CREATE INDEX "${name}" ON backend_fixture.tasks(queue,kind,version,available_at,id) WHERE state IN ('Pending','RetryScheduled')`
      )
    }
    await Effect.runPromise(backend.ready)
  })
  test("real CHECK failures at each production INSERT boundary roll back invoice/job/payload/receipt", async () => {
    for (const id of ["fail-invoice", "fail-job", "fail-payload", "fail-receipt"]) {
      await clear()
      let calls = 0
      const exit = await Effect.runPromiseExit(
        adapter.applicationTransaction((handle) =>
          backend.joinTransaction(handle, (tx) =>
            Effect.gen(function* () {
              calls++
              yield* handle.query("INSERT INTO backend_fixture.invoices VALUES ($1)", [
                id
              ])
              const created = yield* definition.enqueue(tx, input(id))
              yield* handle.query("INSERT INTO backend_fixture.receipts VALUES ($1,$2)", [
                id,
                created.jobId
              ])
            })
          )
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(calls).toBe(1)
      expect(
        (await observer.query("SELECT count(*)::int AS n FROM backend_fixture.invoices"))
          .rows[0].n
      ).toBe(0)
      expect(
        (await observer.query("SELECT count(*)::int AS n FROM backend_fixture.tasks"))
          .rows[0].n
      ).toBe(0)
      expect(
        (
          await observer.query(
            "SELECT count(*)::int AS n FROM backend_fixture.task_artifacts"
          )
        ).rows[0].n
      ).toBe(0)
      expect(
        (await observer.query("SELECT count(*)::int AS n FROM backend_fixture.receipts"))
          .rows[0].n
      ).toBe(0)
    }
  })
  test("protected semantic fingerprints exclude encryption randomness without overwriting stored bytes", async () => {
    await clear()
    const protectedDefinition = Job.make({
      kind: "invoice.private",
      version: 1,
      queue: definition.queue,
      payload: Schema.Struct({
        secret: Payload.protected(
          Schema.Struct({ envelope: Schema.String, fingerprint: Schema.String })
        )
      }),
      encodePayload: encodeJobPayload
    })
    const produce = (envelope: string, fingerprint: string) =>
      Effect.runPromise(
        backend.withTransaction((tx) =>
          protectedDefinition.enqueue(tx, {
            producer: input("protected").producer,
            policy,
            payload: { secret: { envelope, fingerprint } }
          })
        )
      )
    const first = await produce("random-ciphertext-a", "stable-keyed-fingerprint")
    expect(
      await produce("random-ciphertext-b", "stable-keyed-fingerprint")
    ).toMatchObject({ _tag: "AlreadyPresent", jobId: first.jobId })
    await expect(
      produce("random-ciphertext-c", "different-keyed-fingerprint")
    ).rejects.toMatchObject({ _tag: "JobIntegrityConflict" })
    const stored = (
      await observer.query(
        "SELECT payload FROM backend_fixture.task_artifacts WHERE job_id=$1",
        [first.jobId]
      )
    ).rows[0]
    expect(new TextDecoder().decode(stored.payload)).toContain("random-ciphertext-a")
  })
  test("joined success is provisional; owner failure rolls back all writes without inner controls", async () => {
    await clear()
    const failure = { _tag: "OwnerRejected" }
    const before = source.counters.borrows
    const exit = await Effect.runPromise(
      Effect.exit(
        adapter.applicationTransaction((handle) =>
          backend.joinTransaction(handle, (tx) =>
            Effect.gen(function* () {
              yield* handle.query(
                "INSERT INTO backend_fixture.invoices VALUES ('rolled-back')"
              )
              const created = yield* definition.enqueue(tx, input("rolled-back"))
              yield* handle.query(
                "INSERT INTO backend_fixture.receipts VALUES ('rolled-back',$1)",
                [created.jobId]
              )
              return yield* Effect.fail(failure)
            })
          )
        )
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(source.counters.borrows - before).toBe(1)
    expect(await row("rolled-back")).toBeUndefined()
    expect(
      (await observer.query("SELECT count(*)::int AS n FROM backend_fixture.invoices"))
        .rows[0].n
    ).toBe(0)
  })
  test("duplicate returns ID, preserves first payload/policy/availability; conflict aborts parent even when caught", async () => {
    await clear()
    const first = await enqueue("duplicate", "same", policy, 1)
    const changed = Policy.make({ maxAttempts: 10 })
    const before = await row("duplicate")
    const again = await enqueue("duplicate", "same", changed, 2)
    expect(again).toMatchObject({ _tag: "AlreadyPresent", jobId: first.jobId })
    expect(await row("duplicate")).toEqual(before)
    await expect(
      Effect.runPromise(
        adapter.applicationTransaction((handle) =>
          backend.joinTransaction(handle, (tx) =>
            Effect.gen(function* () {
              yield* handle.query(
                "INSERT INTO backend_fixture.invoices VALUES ('conflict')"
              )
              yield* definition
                .enqueue(tx, input("duplicate", "different"))
                .pipe(Effect.catchTag("JobIntegrityConflict", () => Effect.void))
            })
          )
        )
      )
    ).rejects.toMatchObject({
      _tag: "PostgreSqlFailure",
      commitKnowledge: "NotCommitted"
    })
    expect(
      (await observer.query("SELECT * FROM backend_fixture.invoices WHERE id='conflict'"))
        .rows
    ).toHaveLength(0)
    expect(await row("duplicate")).toEqual(before)
  })
  test("concurrent duplicates converge; concurrent semantic conflict rolls back one producer", async () => {
    await clear()
    const results = await Promise.all(Array.from({ length: 4 }, () => enqueue("race")))
    expect(new Set(results.map((r) => r.jobId)).size).toBe(1)
    expect(results.filter((r) => r._tag === "Inserted")).toHaveLength(1)
    const exits = await Promise.all(
      ["a", "b"].map((v) =>
        Effect.runPromise(
          Effect.exit(
            backend.withTransaction((tx) =>
              definition.enqueue(tx, input("conflicting-race", v))
            )
          )
        )
      )
    )
    expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
    expect(exits.filter(Exit.isFailure)).toHaveLength(1)
  })
  test("omitted availability comes from database time; future/unsupported tuples remain untouched", async () => {
    await clear()
    const before = Number(
      (
        await observer.query(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n"
        )
      ).rows[0].n
    )
    await enqueue("db-time")
    const after = Number(
      (
        await observer.query(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n"
        )
      ).rows[0].n
    )
    expect(Number((await row("db-time")).available_at)).toBeGreaterThanOrEqual(before)
    expect(Number((await row("db-time")).available_at)).toBeLessThanOrEqual(after)
    await enqueue("future", "future", policy, after + 100000)
    await observer.query(
      "UPDATE backend_fixture.tasks SET version=2 WHERE operation_id='db-time'"
    )
    expect(await Effect.runPromise(backend.store.claim(request()))).toEqual({
      _tag: "Empty"
    })
    expect((await row("db-time")).state).toBe("Pending")
    expect((await row("future")).state).toBe("Pending")
  })
  test("concurrent SKIP LOCKED claims are distinct and do not increment attempts", async () => {
    await clear()
    await Promise.all(["claim-a", "claim-b", "claim-c"].map((id) => enqueue(id)))
    const results = await Promise.all([claim(), claim(), claim()])
    expect(new Set(results.map((c) => c.ownership.jobId)).size).toBe(3)
    expect(
      results.every(
        (c) => c.snapshot.attemptsMade === 0 && c.snapshot.lifecycleVersion === 1
      )
    ).toBe(true)
  })
  test("a separately held head-row lock is actually skipped instead of waited on", async () => {
    await clear()
    const head = await enqueue("locked-head", "locked-head", policy, 1)
    const other = await enqueue("unlocked-next", "unlocked-next", policy, 2)
    const client = await observer.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT id FROM backend_fixture.tasks WHERE id=$1 FOR UPDATE", [
        head.jobId
      ])
      expect((await claim()).ownership.jobId).toBe(other.jobId)
      expect((await row("locked-head")).state).toBe("Pending")
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })
  test("due equality and immediate neighbors use one genuine PostgreSQL-time snapshot", async () => {
    for (const delta of [-1, 0, 1]) {
      await clear()
      const inserted = await enqueue(
        `due-${delta}`,
        `due-${delta}`,
        policy,
        Policy.maximumMillis
      )
      let sampled = 0
      const controlled: ApplicationAdapter = {
        ...adapter,
        ownedTransaction: (body) =>
          adapter.ownedTransaction((query) =>
            body({
              query: (sql, values) =>
                query.query(sql, values).pipe(
                  Effect.tap((rows) => {
                    if (sql.includes(" AS now") && sampled === 0) {
                      sampled = Number(rows[0]?.now)
                      // Fixture DML only, after the production time read and before selection.
                      // Neither the production SQL nor the clock result is replaced or mocked.
                      return query.query(
                        "UPDATE backend_fixture.tasks SET available_at=$2 WHERE id=$1",
                        [inserted.jobId, sampled + delta]
                      )
                    }
                    return Effect.void
                  })
                )
            })
          )
      }
      const timeBackend = await Effect.runPromise(
        Jobs.make({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(
          Effect.provideService(PostgreSqlApplication, controlled)
        )
      )
      const result = await Effect.runPromise(timeBackend.store.claim(request()))
      expect(result._tag).toBe(delta <= 0 ? "Claimed" : "Empty")
      expect(sampled).toBeGreaterThan(0)
      boundaries.push({
        operation: "due",
        expiry: sampled + delta,
        dbNow: sampled,
        delta
      })
    }
  })
  test("actual expiry equality and neighbors reject/accept the exact same owner without a fake clock", async () => {
    const observed = new Set<number>()
    let lag = 2
    for (let i = 0; i < 90 && observed.size < 3; i++) {
      await clear()
      await enqueue(`expiry-boundary-${i}`)
      const claimed = await claim()
      const setup = await serverNow()
      const target = [-1, 0, 1][i % 3]!
      const expiry = setup + lag + target
      await observer.query(
        "UPDATE backend_fixture.tasks SET lease_expires_at=$2 WHERE id=$1",
        [claimed.ownership.jobId, expiry]
      )
      const before = { ...claimed.snapshot, leaseExpiresAt: expiry }
      const ownership = { ...claimed.ownership, leaseExpiresAt: expiry }
      let now = 0
      const measured: ApplicationAdapter = {
        ...adapter,
        ownedTransaction: (body) =>
          adapter.ownedTransaction((query) =>
            body({
              query: (sql, values) =>
                query.query(sql, values).pipe(
                  Effect.tap((rows) =>
                    Effect.sync(() => {
                      if (sql.includes(" AS now")) {
                        now = Number(rows[0]?.now)
                      }
                    })
                  )
                )
            })
          )
      }
      const measuredBackend = await Effect.runPromise(
        Jobs.make({ ...mapping, operationResponseBudgetMillis: 100 }).pipe(
          Effect.provideService(PostgreSqlApplication, measured)
        )
      )
      const exit = await Effect.runPromiseExit(
        measuredBackend.store.finalize({
          ownership,
          before,
          finalization: { _tag: "Complete" }
        })
      )
      const delta = expiry - now
      expect(now).toBeGreaterThan(0)
      expect(Exit.isSuccess(exit)).toBe(delta > 0)
      if (delta >= -1 && delta <= 1) {
        observed.add(delta)
        boundaries.push({ operation: "expiry", expiry, dbNow: now, delta })
      }
      lag = Math.max(0, now - setup)
    }
    // Finite observation budget; inability to observe any exact neighbor is FAIL,
    // not a skipped timing test. Clock SQL/results are entirely unmodified.
    expect([...observed].sort((a, b) => a - b)).toEqual([-1, 0, 1])
  }, 30000)
  test("expiry recovery equality and neighbors use the genuine selection snapshot", async () => {
    for (const delta of [-1, 0, 1]) {
      await clear()
      await enqueue(`recovery-boundary-${delta}`)
      const claimed = await claim()
      let sampled = 0
      const controlled: ApplicationAdapter = {
        ...adapter,
        ownedTransaction: (body) =>
          adapter.ownedTransaction((query) =>
            body({
              query: (sql, values) =>
                query.query(sql, values).pipe(
                  Effect.tap((rows) => {
                    if (sql.includes(" AS now") && sampled === 0) {
                      sampled = Number(rows[0]?.now)
                      return query.query(
                        "UPDATE backend_fixture.tasks SET lease_expires_at=$2 WHERE id=$1",
                        [claimed.ownership.jobId, sampled + delta]
                      )
                    }
                    return Effect.void
                  })
                )
            })
          )
      }
      const controlledBackend = await make(controlled)
      expect(await Effect.runPromise(controlledBackend.store.recoverExpired(1))).toBe(
        delta <= 0 ? 1 : 0
      )
      expect((await row(`recovery-boundary-${delta}`)).state).toBe(
        delta <= 0 ? "Pending" : "Active"
      )
      boundaries.push({
        operation: "recovery",
        expiry: sampled + delta,
        dbNow: sampled,
        delta
      })
    }
  })
  test("lease reserve equality and neighbors reconcile using actual PostgreSQL time", async () => {
    const observed = new Set<number>()
    let lag = 2
    for (let i = 0; i < 90 && observed.size < 3; i++) {
      await clear()
      await enqueue(`reserve-boundary-${i}`)
      const claimed = await claim()
      const setup = await serverNow()
      const target = [-1, 0, 1][i % 3]!
      const reserve = claimed.snapshot.policy.attemptTimeoutMillis + 100
      const expiry = setup + reserve + lag + target
      await observer.query(
        "UPDATE backend_fixture.tasks SET lease_expires_at=$2 WHERE id=$1",
        [claimed.ownership.jobId, expiry]
      )
      let now = 0
      const measured: ApplicationAdapter = {
        ...adapter,
        ownedTransaction: (body) =>
          adapter.ownedTransaction((query) =>
            body({
              query: (sql, values) =>
                query.query(sql, values).pipe(
                  Effect.tap((rows) =>
                    Effect.sync(() => {
                      if (sql.includes(" AS db_now")) {
                        now = Number(rows[0]?.db_now)
                      }
                    })
                  )
                )
            })
          )
      }
      const measuredBackend = await make(measured)
      const result = await Effect.runPromise(
        measuredBackend.store.reconcileClaim(claimed.ownership.leaseToken)
      )
      const delta = expiry - now - reserve
      expect(now).toBeGreaterThan(0)
      expect(result._tag).toBe(delta >= 0 ? "Owned" : "InsufficientLease")
      if (delta >= -1 && delta <= 1) {
        observed.add(delta)
        boundaries.push({ operation: "reserve", expiry, dbNow: now, delta })
      }
      lag = Math.max(0, now - setup)
    }
    expect([...observed].sort((a, b) => a - b)).toEqual([-1, 0, 1])
  }, 30000)
  test("retry notAfter equality and neighbors preserve the exact persisted scheduling rule", async () => {
    const observed = new Set<number>()
    let lag = 2
    for (let i = 0; i < 90 && observed.size < 3; i++) {
      await clear()
      await enqueue(`retry-boundary-${i}`)
      const claimed = await claim()
      const setup = await serverNow()
      const target = [-1, 0, 1][i % 3]!
      const notAfter =
        setup + claimed.snapshot.policy.retrySchedule.delayMillis + lag + target
      let now = 0
      const measured: ApplicationAdapter = {
        ...adapter,
        ownedTransaction: (body) =>
          adapter.ownedTransaction((query) =>
            body({
              query: (sql, values) =>
                query.query(sql, values).pipe(
                  Effect.tap((rows) =>
                    Effect.sync(() => {
                      if (sql.includes(" AS now")) {
                        now = Number(rows[0]?.now)
                      }
                    })
                  )
                )
            })
          )
      }
      const measuredBackend = await make(measured)
      await Effect.runPromise(
        measuredBackend.store.finalize({
          ownership: claimed.ownership,
          before: claimed.snapshot,
          finalization: { _tag: "Retry", code: "temporary", notAfter }
        })
      )
      const next = now + claimed.snapshot.policy.retrySchedule.delayMillis
      const delta = notAfter - next
      expect(now).toBeGreaterThan(0)
      expect((await row(`retry-boundary-${i}`)).state).toBe(
        delta <= 0 ? "Dead" : "RetryScheduled"
      )
      if (delta >= -1 && delta <= 1) {
        observed.add(delta)
        boundaries.push({
          operation: "retryNotAfter",
          expiry: notAfter,
          dbNow: now,
          delta
        })
      }
      lag = Math.max(0, now - setup)
    }
    expect([...observed].sort((a, b) => a - b)).toEqual([-1, 0, 1])
  }, 30000)
  test("stale/expired owner cannot finalize; bounded recovery changes version and respects stall limits", async () => {
    await clear()
    await enqueue("expired")
    const first = await claim()
    await observer.query(
      "UPDATE backend_fixture.tasks SET lease_expires_at=1 WHERE id=$1",
      [first.ownership.jobId]
    )
    await expect(finish(first)).rejects.toMatchObject({ _tag: "JobOwnershipLost" })
    expect(await Effect.runPromise(backend.store.recoverExpired(1))).toBe(1)
    const recovered = await row("expired")
    expect(recovered.state).toBe("Pending")
    expect(Number(recovered.stalled_count)).toBe(1)
    const second = await claim()
    await expect(finish(first)).rejects.toMatchObject({ _tag: "JobOwnershipLost" })
    await observer.query(
      "UPDATE backend_fixture.tasks SET lease_expires_at=1 WHERE id=$1",
      [second.ownership.jobId]
    )
    expect(await Effect.runPromise(backend.store.recoverExpired(1))).toBe(1)
    expect(await row("expired")).toMatchObject({
      state: "Dead",
      last_failure_code: "stall_limit_exceeded"
    })
  })
  test("retry delay is durable, uses first stored policy and attempt limit terminates", async () => {
    await clear()
    await enqueue(
      "retry",
      "retry",
      Policy.make({ retryDelay: Duration.millis(10000), maxAttempts: 2 })
    )
    const first = await claim()
    await finish(first, { _tag: "Retry", code: "temporary" })
    const stored = await row("retry")
    expect(stored.state).toBe("RetryScheduled")
    expect(Number(stored.available_at) - Number(stored.updated_at)).toBe(10000)
    expect(Number(stored.attempts_made)).toBe(1)
    expect(await Effect.runPromise(backend.store.claim(request()))).toEqual({
      _tag: "Empty"
    })
    await observer.query(
      "UPDATE backend_fixture.tasks SET available_at=1 WHERE operation_id='retry'"
    )
    await finish(await claim(), { _tag: "Retry", code: "temporary" })
    expect(await row("retry")).toMatchObject({ state: "Dead" })
    expect(Number((await row("retry")).attempts_made)).toBe(2)
  })
  test("malformed payload stays untrusted, is isolated without poisoning the next claim", async () => {
    await clear()
    const inserted = await enqueue("malformed")
    await enqueue("healthy")
    await observer.query("UPDATE backend_fixture.tasks SET available_at=1 WHERE id=$1", [
      inserted.jobId
    ])
    await observer.query(
      "UPDATE backend_fixture.task_artifacts SET payload=convert_to('{','UTF8') WHERE job_id=$1",
      [inserted.jobId]
    )
    let dispatched = 0
    await runWorker(() =>
      Effect.sync(() => {
        dispatched++
      })
    )
    expect(dispatched).toBe(0)
    expect((await claim()).prepared).toBeDefined()
    expect(await row("malformed")).toMatchObject({ state: "Isolated" })
  })
  test("unknown claim/finalize/release before and after durable COMMIT never blind-replay", async () => {
    for (const fault of ["before-send", "after-durable"] as const) {
      await clear()
      await enqueue(`fault-${fault}`)
      let remaining = 1
      const faulted = await make(
        Adapter.make(source, () => (remaining-- > 0 ? fault : undefined))
      )
      const token = randomUUID()
      expect(await Effect.runPromise(faulted.store.claim(request(token)))).toEqual({
        _tag: "Unknown"
      })
      const reconciled = await Effect.runPromise(backend.store.reconcileClaim(token))
      expect(reconciled._tag).toBe(fault === "after-durable" ? "Owned" : "NotOwned")
      const claimed = reconciled._tag === "Owned" ? reconciled.claim : await claim()
      remaining = 1
      expect(
        await Effect.runPromise(
          faulted.store.finalize({
            ownership: claimed.ownership,
            before: claimed.snapshot,
            finalization: { _tag: "Complete" }
          })
        )
      ).toEqual({ _tag: "Unknown" })
      const read = await Effect.runPromise(
        backend.store.reconcileFinalization({
          ownership: claimed.ownership,
          before: claimed.snapshot,
          finalization: { _tag: "Complete" }
        })
      )
      expect(read._tag).toBe(fault === "after-durable" ? "Applied" : "StillOwned")
      await clear()
      await enqueue(`release-${fault}`)
      const released = await claim()
      remaining = 1
      expect(
        await Effect.runPromise(
          faulted.store.release(released.ownership, "BeforeExecution")
        )
      ).toEqual({ _tag: "Unknown" })
      expect((await row(`release-${fault}`)).state).toBe(
        fault === "after-durable" ? "Pending" : "Active"
      )
    }
  })
  test("unknown recovery/cleanup are explicit errors, not fabricated counts or replay", async () => {
    for (const fault of ["before-send", "after-durable"] as const) {
      await clear()
      await enqueue(`recovery-${fault}`)
      const claimed = await claim()
      await observer.query(
        "UPDATE backend_fixture.tasks SET lease_expires_at=1 WHERE id=$1",
        [claimed.ownership.jobId]
      )
      let remaining = 1
      const faulted = await make(
        Adapter.make(source, () => (remaining-- > 0 ? fault : undefined))
      )
      await expect(
        Effect.runPromise(faulted.store.recoverExpired(1))
      ).rejects.toMatchObject({ _tag: "PostgreSqlFailure", commitKnowledge: "Unknown" })
      expect(Number((await row(`recovery-${fault}`)).stalled_count)).toBe(
        fault === "after-durable" ? 1 : 0
      )
      await clear()
      await enqueue(`cleanup-${fault}`)
      await finish(await claim())
      remaining = 1
      await expect(Effect.runPromise(faulted.cleanup.cleanup(1))).rejects.toMatchObject({
        _tag: "PostgreSqlFailure",
        commitKnowledge: "Unknown"
      })
      if (fault === "after-durable") {
        expect(await row(`cleanup-${fault}`)).toBeUndefined()
      } else {
        expect(await row(`cleanup-${fault}`)).toMatchObject({ state: "Completed" })
      }
    }
  })
  test("cleanup is bounded and excludes Pending/Active/Isolated/Forever with payload cascade", async () => {
    await clear()
    await enqueue(
      "forever",
      "forever",
      Policy.make({ completedRetention: Duration.infinity })
    )
    await finish(await claim())
    await enqueue("complete-a")
    await finish(await claim())
    await enqueue("complete-b")
    await finish(await claim())
    await enqueue("isolated")
    const c = await claim()
    await Effect.runPromise(
      backend.store.finalize({
        ownership: c.ownership,
        before: c.snapshot,
        finalization: { _tag: "Isolate", code: "invalid_artifact" }
      })
    )
    await enqueue("active")
    await claim()
    await enqueue("pending")
    expect(await Effect.runPromise(backend.cleanup.cleanup(1))).toBe(1)
    expect(await Effect.runPromise(backend.cleanup.cleanup(500))).toBe(1)
    expect(
      (
        await observer.query(
          "SELECT operation_id FROM backend_fixture.tasks ORDER BY operation_id"
        )
      ).rows.map((r) => r.operation_id)
    ).toEqual(["active", "forever", "isolated", "pending"])
    expect(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM backend_fixture.task_artifacts"
        )
      ).rows[0].n
    ).toBe(4)
  })
  test("explicit scoped handles expire; foreign source rejected without borrowing; store rejects joined owner", async () => {
    await clear()
    let saved:
      | JobsTransaction<import("../../src/PostgreSqlTransaction.js").PostgreSqlError>
      | undefined
    await Effect.runPromise(
      adapter.applicationTransaction((handle) =>
        backend.joinTransaction(handle, (tx) =>
          Effect.sync(() => {
            saved = tx
          })
        )
      )
    )
    await expect(
      Effect.runPromise(definition.enqueue(saved!, input("expired-capability")))
    ).rejects.toMatchObject({ _tag: "JobsTransactionClosed" })
    const foreign = Adapter.make(App.source(pool))
    const other = await make(foreign)
    const before = source.counters.borrows
    await expect(
      Effect.runPromise(
        adapter.applicationTransaction((handle) =>
          other.joinTransaction(handle, () => Effect.void)
        )
      )
    ).rejects.toMatchObject({ _tag: "PostgreSqlInvalidHandle", reason: "foreign-source" })
    expect(source.counters.borrows - before).toBe(1)
    await expect(
      Effect.runPromise(
        adapter.applicationTransaction(() => backend.store.claim(request()))
      )
    ).rejects.toMatchObject({
      _tag: "PostgreSqlInvalidHandle",
      reason: "active-transaction"
    })
    await expect(
      Effect.runPromise(App.transaction(source, () => backend.store.claim(request())))
    ).rejects.toMatchObject({
      _tag: "PostgreSqlInvalidHandle",
      reason: "active-transaction"
    })
  })
  test("invalid requests dispatch no mutation and held pools fail finitely", async () => {
    const before = source.counters.borrows
    await expect(
      Effect.runPromise(backend.store.claim({ ...request(), supportedCatalog: [] }))
    ).rejects.toMatchObject({ _tag: "JobStoreProtocolError" })
    await expect(
      Effect.runPromise(backend.store.recoverExpired(501))
    ).rejects.toMatchObject({ _tag: "JobStoreProtocolError" })
    expect(source.counters.borrows).toBe(before)
    const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()))
    try {
      await expect(enqueue("exhaustion")).rejects.toBeInstanceOf(PostgreSqlFailure)
    } finally {
      clients.forEach((c) => c.release())
    }
    expect(pool.waitingCount).toBe(0)
  })
  test("interruption preserves caller interruption and rolls back domain+job writes", async () => {
    await clear()
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const fiber = yield* adapter
          .applicationTransaction((handle) =>
            backend.joinTransaction(handle, (tx) =>
              Effect.gen(function* () {
                yield* handle.query(
                  "INSERT INTO backend_fixture.invoices VALUES ('interrupted')"
                )
                yield* definition.enqueue(tx, input("interrupted"))
                yield* Deferred.succeed(ready, undefined)
                return yield* Effect.never
              })
            )
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(ready)
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await row("interrupted")).toBeUndefined()
  })
})
