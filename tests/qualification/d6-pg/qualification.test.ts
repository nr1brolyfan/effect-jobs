import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Pool, type PoolConfig } from "pg"
import { readQualificationResource } from "../Resource.mjs"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Policy from "../../../src/JobPolicy.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import type { JobsTransaction } from "../../../src/JobTransaction.js"
import * as App from "./ApplicationTransactions.js"
import * as Bridge from "./PgBridge.js"

// Credentials are read in-process, never printed or passed through argv.
const resourceDirectory = process.env.D6_RESOURCE_DIRECTORY
const enabled = resourceDirectory !== undefined
const definition = Job.make({
  kind: "invoice.generate",
  version: 1,
  queue: Queue.make("billing"),
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: encodeJobPayload
})
const producer = Producer.make({ operation: "billing.issue", slots: ["generate"] })
class CallerValue extends Context.Service<CallerValue, { readonly value: number }>()(
  "d6/CallerValue"
) {}
const input = (id: string, payload = id) => ({
  producer: producer.identity({ operationId: id, slot: "generate" }),
  payload: { invoiceId: payload },
  policy: Policy.make()
})

describe.skipIf(!enabled)("D6 real pg qualification", () => {
  let admin: Pool
  let pool: Pool
  let observer: Pool
  let source: App.Source
  let integration: Bridge.Integration
  let roleCreated = false
  let schemaCreated = false
  let temporaryPrivilegeRemoved = false
  let serverVersion = ""
  let runtimeConfig: PoolConfig
  const role = "d6_fixture_runtime"
  beforeAll(async () => {
    const entries = readFileSync(`${resourceDirectory}/postgres.env`, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const i = line.indexOf("=")
        return [line.slice(0, i), line.slice(i + 1)]
      })
    const env = Object.fromEntries(entries)
    const ownership = readQualificationResource(resourceDirectory!)
    const config: PoolConfig = {
      host: "127.0.0.1",
      port: Number(ownership.ports["5432/tcp"][0].HostPort),
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      max: 2,
      connectionTimeoutMillis: 500,
      statement_timeout: 2000,
      query_timeout: 3000,
      idleTimeoutMillis: 1000
    }
    // This fixed task schema/role is exclusively owned; no existing object is reset.
    admin = new Pool(config)
    serverVersion = (await admin.query("SHOW server_version")).rows[0].server_version
    const password = randomBytes(24).toString("hex")
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    )
    roleCreated = true
    // PUBLIC's default TEMP grant would otherwise give every runtime login DDL.
    // This is only the dedicated task database; restore this fixture-owned change below.
    const publicTemp = await admin.query(`SELECT EXISTS (
      SELECT 1 FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='TEMPORARY'
    ) AS granted`)
    if (publicTemp.rows[0].granted) {
      await admin.query("REVOKE TEMPORARY ON DATABASE effect_jobs_d6 FROM PUBLIC")
      temporaryPrivilegeRemoved = true
    }
    await admin.query("CREATE SCHEMA d6_fixture")
    schemaCreated = true
    await admin.query(`
      CREATE TABLE d6_fixture.invoices (id text PRIMARY KEY CHECK (id <> 'fail-invoices'));
      CREATE TABLE d6_fixture.jobs (id uuid PRIMARY KEY, operation text NOT NULL,
        operation_id text NOT NULL, slot text NOT NULL, catalog text NOT NULL, policy text NOT NULL,
        UNIQUE(operation,operation_id,slot), CHECK (operation_id <> 'fail-jobs'));
      CREATE TABLE d6_fixture.job_payloads (job_id uuid PRIMARY KEY REFERENCES d6_fixture.jobs(id),
        payload bytea NOT NULL CHECK (position(convert_to('fail-job_payloads','UTF8') in payload)=0), projection bytea NOT NULL);
      CREATE TABLE d6_fixture.operation_receipts (id text PRIMARY KEY REFERENCES d6_fixture.invoices(id),
        job_id uuid NOT NULL REFERENCES d6_fixture.jobs(id), CHECK (id <> 'fail-operation_receipts'));
      GRANT USAGE ON SCHEMA d6_fixture TO ${role};
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA d6_fixture TO ${role};
      GRANT CONNECT ON DATABASE effect_jobs_d6 TO ${role};
    `)
    runtimeConfig = { ...config, user: role, password, max: 1 }
    pool = new Pool(runtimeConfig)
    observer = new Pool(runtimeConfig)
    source = App.source(pool)
    integration = await Effect.runPromise(
      Bridge.make.pipe(Effect.provideService(Bridge.ApplicationSource, source))
    )
  }, 30000)
  afterAll(async () => {
    // Application, not bridge, closes every pool and removes its objects.
    await pool?.end()
    await observer?.end()
    if (admin !== undefined) {
      try {
        if (schemaCreated) {
          await admin.query("DROP SCHEMA d6_fixture CASCADE")
        }
        if (roleCreated) {
          await admin.query(`DROP OWNED BY ${role}`)
          await admin.query(`DROP ROLE ${role}`)
        }
        if (temporaryPrivilegeRemoved) {
          await admin.query("GRANT TEMPORARY ON DATABASE effect_jobs_d6 TO PUBLIC")
        }
        const cleaned = (
          await admin.query(`SELECT
          (SELECT count(*)::int FROM pg_namespace WHERE nspname='d6_fixture') AS schemas,
          (SELECT count(*)::int FROM pg_roles WHERE rolname='d6_fixture_runtime') AS roles`)
        ).rows[0]
        expect(cleaned).toEqual({ schemas: 0, roles: 0 })
        if (process.env.D6_EVIDENCE_FILE !== undefined && source !== undefined) {
          writeFileSync(
            process.env.D6_EVIDENCE_FILE,
            JSON.stringify(
              {
                runtime: process.versions.bun === undefined ? "node" : "bun",
                runtimeVersion: process.versions.bun ?? process.version,
                serverVersion,
                driver: "pg@8.23.0",
                effect: "4.0.0",
                borrows: source.counters.borrows,
                sqlStatements: source.counters.sql.length,
                begins: source.counters.sql.filter((s) => s === "BEGIN").length,
                commits: source.counters.sql.filter((s) => s === "COMMIT").length,
                rollbacks: source.counters.sql.filter((s) => s === "ROLLBACK").length,
                savepoints: source.counters.sql.filter((s) => s.startsWith("SAVEPOINT"))
                  .length,
                ddl: source.counters.sql.filter((s) =>
                  /^(CREATE|ALTER|DROP|TRUNCATE)/.test(s)
                ).length,
                physicalConnectionPids: source.counters.pids,
                cleanup: cleaned,
                publicTemporaryPrivilegeRestored: temporaryPrivilegeRemoved
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

  const counts = async (id: string) => {
    const { rows } = await observer.query(
      `SELECT
      (SELECT count(*)::int FROM d6_fixture.invoices WHERE id=$1) AS invoices,
      (SELECT count(*)::int FROM d6_fixture.jobs WHERE operation_id=$1) AS jobs,
      (SELECT count(*)::int FROM d6_fixture.job_payloads p JOIN d6_fixture.jobs j ON p.job_id=j.id WHERE operation_id=$1) AS payloads,
      (SELECT count(*)::int FROM d6_fixture.operation_receipts WHERE id=$1) AS receipts`,
      [id]
    )
    return rows[0]
  }
  const all = { invoices: 1, jobs: 1, payloads: 1, receipts: 1 }
  const none = { invoices: 0, jobs: 0, payloads: 0, receipts: 0 }
  const flow = (id: string, tx: JobsTransaction<Bridge.Failure>, handle: App.Handle) =>
    Effect.gen(function* () {
      yield* handle.query("INSERT INTO d6_fixture.invoices (id) VALUES ($1)", [id])
      const result = yield* definition.enqueueInTransaction(tx, input(id))
      yield* handle.query(
        "INSERT INTO d6_fixture.operation_receipts (id,job_id) VALUES ($1,$2)",
        [id, result.jobId]
      )
      return result
    })
  const failureTags = <A, E>(exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit)
      ? exit.cause.reasons
          .filter(Cause.isFailReason)
          .map((r) => (r.error as { _tag: string })._tag)
      : []

  test("actual runtime, driver, Effect and server match qualification pins", () => {
    const runtime = process.versions.bun === undefined ? "node" : "bun"
    expect(process.env.D6_EXPECT_RUNTIME).toBe(runtime)
    expect(process.versions.bun ?? process.version).toBe(
      runtime === "bun" ? "1.4.2" : "v24.15.0"
    )
    expect(
      JSON.parse(
        readFileSync(new URL("./node_modules/pg/package.json", import.meta.url), "utf8")
      ).version
    ).toBe("8.23.0")
    expect(
      JSON.parse(
        readFileSync(
          new URL("./node_modules/effect/package.json", import.meta.url),
          "utf8"
        )
      ).version
    ).toBe("4.0.0")
    expect(serverVersion).toMatch(/^16\.15/)
  })

  test("import/construction/layer do not borrow, start workers, do DDL or close pools", async () => {
    expect(source.counters.borrows).toBe(0)
    expect(pool.totalCount).toBe(0)
    await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          Bridge.layerNoDeps.pipe(
            Layer.provide(Layer.succeed(Bridge.ApplicationSource, source))
          )
        )
      )
    )
    expect(source.counters.sql).toEqual([])
    expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1)
  })
  test("delegated establishment atomically commits the real definition seam", async () => {
    const n = source.counters.borrows
    const s = source.counters.sql.length
    const result = await Effect.runPromise(
      integration.withTransaction((tx, h) => flow("commit", tx, h))
    )
    expect(result._tag).toBe("Inserted")
    expect(await counts("commit")).toEqual(all)
    expect(source.counters.borrows - n).toBe(1)
    const sql = source.counters.sql.slice(s)
    expect(sql.filter((s) => s === "BEGIN")).toHaveLength(1)
    expect(sql.filter((s) => s === "COMMIT")).toHaveLength(1)
    expect(sql.some((s) => /SAVEPOINT|CREATE|ALTER|DROP/.test(s))).toBe(false)
  })
  test.each(["invoices", "jobs", "job_payloads", "operation_receipts"])(
    "rollback at %s insert without replay",
    async (table) => {
      const id = `fail-${table}`
      let invocations = 0
      const exit = await Effect.runPromiseExit(
        integration.withTransaction((tx, h) => {
          invocations++
          return flow(id, tx, h)
        })
      )
      expect(failureTags(exit)).toContain("PgFailure")
      expect(await counts(id)).toEqual(none)
      expect(invocations).toBe(1)
    }
  )
  test("after receipt failure preserves caller error and rolls back all writes", async () => {
    const error = { _tag: "BusinessFailure", value: "sentinel" }
    const exit = await Effect.runPromiseExit(
      integration.withTransaction((tx, h) =>
        flow("late", tx, h).pipe(Effect.flatMap(() => Effect.fail(error)))
      )
    )
    expect(
      Exit.isFailure(exit) &&
        exit.cause.reasons.some((r) => Cause.isFailReason(r) && r.error === error)
    ).toBe(true)
    expect(await counts("late")).toEqual(none)
  })
  test("joined inner success is provisional; exact source/connection, no independent control or borrow", async () => {
    const n = source.counters.borrows
    const s = source.counters.sql.length
    const exit = await Effect.runPromiseExit(
      App.transaction(source, (h) =>
        Effect.gen(function* () {
          const before = yield* h.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
          const start = source.counters.sql.length
          const result = yield* integration.withTransaction((tx, joined) => {
            expect(joined).toBe(h)
            return flow("outer-rollback", tx, joined)
          })
          expect(result._tag).toBe("Inserted")
          expect(
            source.counters.sql
              .slice(start)
              .some((s) => /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/.test(s))
          ).toBe(false)
          const after = yield* h.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
          expect(after).toEqual(before)
          yield* Effect.promise(async () => {
            expect(await counts("outer-rollback")).toEqual(none)
          })
          return yield* Effect.fail("outer owner rejection")
        })
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await counts("outer-rollback")).toEqual(none)
    expect(source.counters.borrows - n).toBe(1)
    expect(source.counters.sql.slice(s).filter((s) => s === "ROLLBACK")).toHaveLength(1)
  })
  test("duplicate retains immutable bytes/config; semantic conflict rolls back parent", async () => {
    const prior = (
      await observer.query(
        "SELECT id,policy FROM d6_fixture.jobs WHERE operation_id='commit'"
      )
    ).rows[0]
    const payload = (
      await observer.query(
        "SELECT payload FROM d6_fixture.job_payloads WHERE job_id=$1",
        [prior.id]
      )
    ).rows[0].payload
    const result = await Effect.runPromise(
      integration.withTransaction((tx) =>
        definition.enqueueInTransaction(tx, {
          ...input("commit"),
          policy: Policy.make({ maxAttempts: 7 })
        })
      )
    )
    expect(result).toEqual({ _tag: "AlreadyPresent", jobId: prior.id })
    expect(
      (await observer.query("SELECT policy FROM d6_fixture.jobs WHERE id=$1", [prior.id]))
        .rows[0].policy
    ).toBe(prior.policy)
    expect(
      (
        await observer.query(
          "SELECT payload FROM d6_fixture.job_payloads WHERE job_id=$1",
          [prior.id]
        )
      ).rows[0].payload
    ).toEqual(payload)
    const exit = await Effect.runPromiseExit(
      integration.withTransaction((tx, h) =>
        Effect.gen(function* () {
          yield* h.query(
            "INSERT INTO d6_fixture.invoices (id) VALUES ('conflict-parent')"
          )
          return yield* definition.enqueueInTransaction(tx, input("commit", "changed"))
        })
      )
    )
    expect(failureTags(exit)).toContain("JobIntegrityConflict")
    expect(await counts("conflict-parent")).toEqual(none)
    expect(await counts("commit")).toEqual(all)
  })
  test("foreign/query-only/inactive handles rejected with no fallback borrow", async () => {
    const foreign = App.source(pool) // Identical Pool and DSN still not the same source identity.
    const foreignBridge = await Effect.runPromise(
      Bridge.make.pipe(Effect.provideService(Bridge.ApplicationSource, foreign))
    )
    const n = source.counters.borrows
    let retained!: App.Handle
    await Effect.runPromise(
      App.transaction(source, (h) =>
        Effect.gen(function* () {
          retained = h
          const a = yield* Effect.exit(foreignBridge.join(h, () => Effect.void))
          expect(failureTags(a)).toContain("InvalidHandle")
          const b = yield* Effect.exit(foreignBridge.withTransaction(() => Effect.void))
          expect(failureTags(b)).toContain("InvalidHandle")
        })
      )
    )
    expect(foreign.counters.borrows).toBe(0)
    const inactive = await Effect.runPromiseExit(
      integration.join(retained, () => Effect.void)
    )
    expect(failureTags(inactive)).toContain("InvalidHandle")
    const queryOnly = await Effect.runPromiseExit(
      integration.join({ query: retained.query }, () => Effect.void)
    )
    expect(failureTags(queryOnly)).toContain("InvalidHandle")
    expect(source.counters.borrows - n).toBe(1)
  })
  test.each(["success", "failure", "defect", "interruption"])(
    "capability invalidated on %s; original caller channel survives",
    async (mode) => {
      let retained!: JobsTransaction<Bridge.Failure>
      const marker = { sentinel: mode }
      const ready = Deferred.makeUnsafe<void>()
      const program = integration.withTransaction((tx, h) =>
        Effect.gen(function* () {
          retained = tx
          yield* flow(`lifetime-${mode}`, tx, h)
          yield* Deferred.succeed(ready, undefined)
          if (mode === "failure") {
            return yield* Effect.fail(marker)
          }
          if (mode === "defect") {
            return yield* Effect.die(marker)
          }
          if (mode === "interruption") {
            return yield* Effect.never
          }
          return marker
        })
      )
      const exit =
        mode === "interruption"
          ? await Effect.runPromise(
              Effect.gen(function* () {
                const fiber = yield* Effect.forkChild(program)
                yield* Deferred.await(ready)
                yield* Fiber.interrupt(fiber)
                return yield* Fiber.await(fiber)
              })
            )
          : await Effect.runPromiseExit(program)
      if (mode === "success") {
        expect(Exit.isSuccess(exit) && exit.value).toBe(marker)
      }
      if (mode === "failure") {
        expect(
          Exit.isFailure(exit) &&
            exit.cause.reasons.some((r) => Cause.isFailReason(r) && r.error === marker)
        ).toBe(true)
      }
      if (mode === "defect") {
        expect(
          Exit.isFailure(exit) &&
            exit.cause.reasons.some((r) => Cause.isDieReason(r) && r.defect === marker)
        ).toBe(true)
      }
      if (mode === "interruption") {
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      }
      const n = source.counters.sql.length
      expect(
        failureTags(
          await Effect.runPromiseExit(
            definition.enqueueInTransaction(retained, input("expired"))
          )
        )
      ).toContain("JobsTransactionClosed")
      expect(source.counters.sql.length).toBe(n)
      expect(await counts(`lifetime-${mode}`)).toEqual(mode === "success" ? all : none)
    }
  )
  test.each(["before-send", "after-durable"] as const)(
    "%s COMMIT response fault stays Unknown, no replay/reconcile",
    async (fault) => {
      const s = source.counters.sql.length
      let invocations = 0
      const exit = await Effect.runPromiseExit(
        App.transaction(
          source,
          (h) =>
            integration.join(h, (tx) => {
              invocations++
              return flow(fault, tx, h)
            }),
          fault
        )
      )
      expect(
        Exit.isFailure(exit) &&
          exit.cause.reasons.some(
            (r) =>
              Cause.isFailReason(r) &&
              r.error instanceof App.PgFailure &&
              r.error.commitKnowledge === "Unknown"
          )
      ).toBe(true)
      expect(invocations).toBe(1)
      const sql = source.counters.sql.slice(s)
      expect(sql.filter((s) => s === "BEGIN")).toHaveLength(1)
      expect(sql).toHaveLength(7)
      expect(sql.filter((s) => s.startsWith("SELECT"))).toEqual([
        "SELECT pg_backend_pid() AS pid"
      ])
      expect(await counts(fault)).toEqual(fault === "before-send" ? none : all)
    }
  )
  test("invocation-local nested callback lifetime does not revoke the other capability", async () => {
    let inner!: JobsTransaction<Bridge.Failure>
    let outer!: JobsTransaction<Bridge.Failure>
    const n = source.counters.borrows
    await Effect.runPromise(
      App.transaction(source, (h) =>
        integration.join(h, (tx) =>
          Effect.gen(function* () {
            outer = tx
            yield* integration.join(h, (nested) =>
              Effect.sync(() => {
                inner = nested
                expect(inner).not.toBe(outer)
              })
            )
            expect(
              failureTags(
                yield* Effect.exit(
                  definition.enqueueInTransaction(inner, input("inner-expired"))
                )
              )
            ).toContain("JobsTransactionClosed")
            // The same physical transaction is still active, with its outer capability intact.
            yield* flow("invocation-local", outer, h)
          })
        )
      )
    )
    expect(source.counters.borrows - n).toBe(1)
    expect(await counts("invocation-local")).toEqual(all)
    expect(await counts("inner-expired")).toEqual(none)
    expect(
      failureTags(
        await Effect.runPromiseExit(
          definition.enqueueInTransaction(outer, input("outer-expired"))
        )
      )
    ).toContain("JobsTransactionClosed")
  })
  test("caller service requirements survive Layer construction and delegated callback", async () => {
    const result = await Effect.runPromise(
      integration
        .withTransaction(() => CallerValue.pipe(Effect.map((caller) => caller.value)))
        .pipe(Effect.provideService(CallerValue, { value: 42 }))
    )
    expect(result).toBe(42)
  })
  test("negative control: independent same-DSN source breaks atomicity", async () => {
    const other = App.source(observer)
    const bridge = await Effect.runPromise(
      Bridge.make.pipe(Effect.provideService(Bridge.ApplicationSource, other))
    )
    const exit = await Effect.runPromiseExit(
      App.transaction(source, (h) =>
        Effect.gen(function* () {
          yield* h.query("INSERT INTO d6_fixture.invoices (id) VALUES ('negative')")
          // Explicitly leave the ambient scope: this independent operation commits separately.
          yield* Effect.promise(() =>
            Effect.runPromise(
              bridge.withTransaction((tx) =>
                definition.enqueueInTransaction(tx, input("negative"))
              )
            )
          )
          return yield* Effect.fail("parent rollback")
        })
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(source.counters.pids.at(-1)).not.toBe(other.counters.pids.at(-1))
    expect(await counts("negative")).toEqual({ ...none, jobs: 1, payloads: 1 })
  })
  test("bounded pool exhaustion/readiness and runtime role has no DDL/TRUNCATE/admin authority", async () => {
    const held = await pool.connect()
    try {
      const start = performance.now()
      const exit = await Effect.runPromiseExit(
        integration.withTransaction(() => Effect.void)
      )
      expect(failureTags(exit)).toContain("PgFailure")
      expect(performance.now() - start).toBeLessThan(2000)
      expect(pool.waitingCount).toBe(0)
    } finally {
      held.release()
    }
    const flags = (
      await pool.query(
        "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user"
      )
    ).rows[0]
    expect(flags).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false })
    await expect(
      pool.query("CREATE TABLE d6_fixture.denied (id int)")
    ).rejects.toMatchObject({ code: "42501" })
    await expect(pool.query("CREATE TEMP TABLE denied (id int)")).rejects.toMatchObject({
      code: "42501"
    })
    await expect(pool.query("TRUNCATE d6_fixture.jobs CASCADE")).rejects.toMatchObject({
      code: "42501"
    })
    expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1)
    expect(source.counters.sql.some((s) => /^(CREATE|ALTER|DROP|TRUNCATE)/.test(s))).toBe(
      false
    )
  })
  test("failed application readiness is bounded and never reaches BEGIN/body", async () => {
    const rejectedPool = new Pool({
      ...runtimeConfig,
      password: "deliberately-invalid-fixture-password"
    })
    const rejectedSource = App.source(rejectedPool)
    const rejectedBridge = await Effect.runPromise(
      Bridge.make.pipe(Effect.provideService(Bridge.ApplicationSource, rejectedSource))
    )
    let calls = 0
    try {
      const start = performance.now()
      const exit = await Effect.runPromiseExit(
        rejectedBridge.withTransaction(() =>
          Effect.sync(() => {
            calls++
          })
        )
      )
      expect(failureTags(exit)).toContain("PgFailure")
      expect(performance.now() - start).toBeLessThan(2000)
      expect(calls).toBe(0)
      expect(rejectedSource.counters.borrows).toBe(1)
      expect(rejectedSource.counters.sql).toEqual([])
      expect(rejectedPool.waitingCount).toBe(0)
    } finally {
      await rejectedPool.end()
    }
  })
})
