import { readQualificationResource } from "../Resource.mjs"
// Native low-level SQL APIs are intentionally pinned to 4.0.0 by the consumer runner.
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Pool } from "pg"
import type { PoolConfig } from "pg"
import type { Handle } from "./NativeApplication.mjs"
import type { PostgreSqlError } from "effect-jobs/PostgreSqlTransaction"
import type { EnqueueResult } from "effect-jobs/JobContract"
import type { JobEnqueueError } from "effect-jobs/JobTransaction"
type NativeDb = Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
type NativeTx = Parameters<Parameters<NativeDb["transaction"]>[0]>[0]
import type { SqlError } from "effect/sql/SqlError"
// Drizzle rc still references the removed effect/unstable/sql/SqlError path.
// Restore only this declaration boundary to the actual pinned driver error;
// full upstream declaration checking remains a separately reported limitation.
const transact = <A, E, R>(
  db: Pick<NativeDb, "transaction">,
  body: (tx: NativeTx) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R> => {
  const invoke: (
    body: (tx: NativeTx) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R> = db.transaction.bind(db)
  return invoke(body)
}
import { Cause, Context, Deferred, Effect, Exit, Fiber, Redacted, Schema } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { pgSchema, text } from "drizzle-orm/pg-core"
import { eq } from "drizzle-orm"
import * as Tables from "effect-jobs/PostgreSqlSchema"
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import {
  PostgreSqlApplication,
  PostgreSqlInvalidHandle
} from "effect-jobs/PostgreSqlTransaction"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import { encodeJobPayload } from "effect-jobs/JobPayloadCodec"
import * as Application from "./NativeApplication.mjs"

const resource = process.env.D6_RESOURCE_DIRECTORY
assert(resource, "private resource directory required")
const ownership = readQualificationResource(resource)
assert(Date.now() < Date.parse(ownership.deadline) - 60000, "resource deadline")
const env = Object.fromEntries(
  readFileSync(`${resource}/postgres.env`, "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=")
      return [line.slice(0, i), line.slice(i + 1)]
    })
)
assert.equal(env.POSTGRES_DB, "effect_jobs_d6")
const reasonOf = (error: PostgreSqlError): string => {
  assert(error instanceof PostgreSqlInvalidHandle)
  return error.reason
}
const schema = "drizzle_native"
const role = "drizzle_native_runtime"
const mapping = Tables.tables({ schema, jobsTable: "tasks", payloadsTable: "artifacts" })
const tables = makeJobTables(mapping)
const domain = pgSchema(schema).table("invoices", { id: text("id").primaryKey() })
const receipts = pgSchema(schema).table("receipts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull()
})
const definition = Job.make({
  kind: "invoice.generate",
  version: 1,
  queue: Queue.make("billing"),
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: encodeJobPayload
})
const producer = Producer.make({ operation: "billing.native", slots: ["generate"] })
const input = (id: string, value = id) => ({
  producer: producer.identity({ operationId: id, slot: "generate" }),
  payload: { invoiceId: value },
  policy: Policy.make()
})
const config = {
  host: "127.0.0.1",
  port: Number(ownership.ports["5432/tcp"][0].HostPort),
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
  connectionTimeoutMillis: 500,
  query_timeout: 3000,
  statement_timeout: 2000
}
const admin = new Pool(config satisfies PoolConfig)
let schemaCreated = false
let roleCreated = false
let stage = "setup"
const passed: Array<string> = []
let cleanup: { schemas: number; roles: number } | undefined
const check = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    stage = name
    yield* effect
    passed.push(name)
  })
try {
  assert.match(
    (await admin.query("SHOW server_version")).rows[0].server_version,
    /^16\.15(?:\s|$)/
  )
  const secret = randomBytes(24).toString("hex")
  await admin.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
  )
  roleCreated = true
  await admin.query(`CREATE SCHEMA ${schema}`)
  schemaCreated = true
  await admin.query(Tables.migration(mapping))
  await admin.query(`CREATE TABLE ${schema}.invoices (id text PRIMARY KEY CHECK (id <> 'fail-domain'));
    CREATE TABLE ${schema}.receipts (id text PRIMARY KEY REFERENCES ${schema}.invoices(id),job_id text NOT NULL REFERENCES ${schema}.tasks(id),CHECK(id <> 'fail-receipt'));
    ALTER TABLE ${schema}.tasks ADD CHECK(operation_id <> 'fail-job');
    ALTER TABLE ${schema}.artifacts ADD CHECK(position(convert_to('fail-payload','UTF8') in payload)=0);
    GRANT CONNECT ON DATABASE effect_jobs_d6 TO ${role}; GRANT USAGE ON SCHEMA ${schema} TO ${role};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`)
  const observer = new Pool({ ...config, user: role, password: secret })
  const count = async (id: string) =>
    (
      await observer.query(
        `SELECT
    (SELECT count(*)::int FROM ${schema}.invoices WHERE id=$1) AS domain,
    (SELECT count(*)::int FROM ${schema}.tasks WHERE operation_id=$1) AS jobs,
    (SELECT count(*)::int FROM ${schema}.artifacts p JOIN ${schema}.tasks j ON j.id=p.job_id WHERE j.operation_id=$1) AS payload,
    (SELECT count(*)::int FROM ${schema}.receipts WHERE id=$1) AS receipt`,
        [id]
      )
    ).rows[0]
  const none = { domain: 0, jobs: 0, payload: 0, receipt: 0 }
  const all = { domain: 1, jobs: 1, payload: 1, receipt: 1 }
  try {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* PgClient.PgClient
          const db = yield* Drizzle.makeWithDefaults()
          const application = Application.make(client)
          const backend = yield* Jobs.make({
            ...mapping,
            operationResponseBudgetMillis: 100
          }).pipe(Effect.provideService(PostgreSqlApplication, application))
          const writes = (id: string, tx: NativeTx, handle: unknown) =>
            backend.joinTransaction(handle, (jobsTx) =>
              Effect.gen(function* () {
                yield* tx.insert(domain).values({ id })
                const result = yield* definition.enqueue(jobsTx, input(id))
                yield* tx.insert(receipts).values({ id, jobId: result.jobId })
                return result
              })
            )
          const run = (id: string) =>
            application.sanitizeControls(
              transact(db, (tx) =>
                application.register((handle) => writes(id, tx, handle))
              )
            )
          yield* check(
            "native schema/query/transaction atomic commit",
            Effect.gen(function* () {
              const result = yield* run("commit")
              assert.equal(result._tag, "Inserted")
              assert.deepEqual(yield* Effect.promise(() => count("commit")), all)
              const selected = yield* db
                .select()
                .from(tables.jobs)
                .where(eq(tables.jobs.id, result.jobId))
              assert.equal(selected[0]!.availableAt > 0, true)
              const artifacts = yield* db
                .select()
                .from(tables.payloads)
                .where(eq(tables.payloads.jobId, result.jobId))
              const encoded = yield* encodeJobPayload(definition.payload, {
                invoiceId: "commit"
              })
              assert.deepEqual(artifacts[0]!.payload, encoded.payloadBytes)
              assert.deepEqual(artifacts[0]!.projection, encoded.semanticProjectionBytes)
            })
          )
          yield* check(
            "native duplicate equality and first stored bytes",
            Effect.gen(function* () {
              const duplicate = yield* backend.withTransaction((tx) =>
                definition.enqueue(tx, input("commit"))
              )
              assert.equal(duplicate._tag, "AlreadyPresent")
              assert.deepEqual(yield* Effect.promise(() => count("commit")), all)
            })
          )
          yield* check(
            "caught integrity conflict aborts native owner COMMIT, no replay",
            Effect.gen(function* () {
              let invocations = 0
              const exit = yield* Effect.exit(
                application.sanitizeControls(
                  transact(db, (tx) =>
                    application.register((handle) =>
                      backend.joinTransaction(handle, (jobsTx) =>
                        Effect.gen(function* () {
                          invocations++
                          yield* tx.insert(domain).values({ id: "caught-conflict" })
                          yield* definition
                            .enqueue(jobsTx, input("commit", "changed"))
                            .pipe(
                              Effect.catchTag("JobIntegrityConflict", () => Effect.void)
                            )
                        })
                      )
                    )
                  )
                )
              )
              assert(Exit.isFailure(exit))
              assert.equal(invocations, 1)
              assert(
                exit.cause.reasons.every(
                  (r) => Cause.isFailReason(r) && r.error._tag === "PostgreSqlFailure"
                )
              )
              assert.deepEqual(
                yield* Effect.promise(() => count("caught-conflict")),
                none
              )
            })
          )
          yield* check(
            "caller Context requirement survives joined callback",
            Effect.gen(function* () {
              const Caller = Context.Service<{ readonly value: string }>(
                "drizzle-native/Caller"
              )
              const result = yield* backend
                .withTransaction(() =>
                  Effect.gen(function* () {
                    return (yield* Caller).value
                  })
                )
                .pipe(Effect.provideService(Caller, { value: "caller-context" }))
              assert.equal(result, "caller-context")
            })
          )
          yield* check(
            "native bytea custom codec round trip",
            Effect.gen(function* () {
              const raw = Uint8Array.of(0, 1, 127, 128, 255)
              const original = yield* db.select().from(tables.payloads)
              const id = original[0]!.jobId
              yield* db
                .update(tables.payloads)
                .set({ payload: raw, projection: raw })
                .where(eq(tables.payloads.jobId, id))
              const selected = yield* db
                .select()
                .from(tables.payloads)
                .where(eq(tables.payloads.jobId, id))
              assert.deepEqual(selected[0]!.payload, raw)
              assert.deepEqual(selected[0]!.projection, raw)
              yield* db
                .update(tables.payloads)
                .set({
                  payload: original[0]!.payload,
                  projection: original[0]!.projection
                })
                .where(eq(tables.payloads.jobId, id))
            })
          )
          for (const id of ["fail-domain", "fail-job", "fail-payload", "fail-receipt"]) {
            yield* check(
              `${id} atomic rollback`,
              Effect.gen(function* () {
                const failure = yield* Effect.exit(run(id))
                assert(Exit.isFailure(failure))
                assert(
                  failure.cause.reasons.every(
                    (r) => Cause.isFailReason(r) && r.error._tag === "PostgreSqlFailure"
                  )
                )
                assert.deepEqual(yield* Effect.promise(() => count(id)), none)
              })
            )
          }
          yield* check(
            "exact connection, provisional inner success, no joined savepoint",
            Effect.gen(function* () {
              const rejection = Object.freeze({ reason: "outer-rejection" })
              const exit = yield* Effect.exit(
                transact(db, (tx) =>
                  application.instrument((handle) =>
                    Effect.gen(function* () {
                      const query = yield* application.validate(handle)
                      const a = yield* query.query("SELECT pg_backend_pid() AS pid")
                      const b = yield* client.unsafe<{ pid: number }>(
                        "SELECT pg_backend_pid() AS pid"
                      )
                      stage = "same physical PID"
                      assert.equal(a[0]!.pid, b[0]!.pid)
                      const before = application.controls.length
                      yield* application.withTransaction((registered) =>
                        writes("provisional", tx, registered)
                      )
                      stage = "join has zero controls"
                      assert.equal(application.controls.length, before)
                      assert.deepEqual(
                        yield* Effect.promise(() => count("provisional")),
                        none
                      )
                      return yield* Effect.fail(rejection)
                    })
                  )
                )
              )
              assert(
                Exit.isFailure(exit) &&
                  exit.cause.reasons.some(
                    (r) => Cause.isFailReason(r) && r.error === rejection
                  )
              )
              stage = "observer provisional visibility"
              assert.deepEqual(yield* Effect.promise(() => count("provisional")), none)
            })
          )
          yield* check(
            "nested Drizzle negative control creates real savepoint",
            transact(db, (tx) =>
              application.instrument(() =>
                Effect.gen(function* () {
                  const before = application.controls.length
                  yield* transact(tx, () => Effect.void)
                  assert(
                    application.controls
                      .slice(before)
                      .some((s) => s.startsWith("SAVEPOINT"))
                  )
                })
              )
            )
          )
          yield* check(
            "private source and active lifetime validation",
            Effect.gen(function* () {
              let saved: Handle | undefined
              const foreign = Application.make(client)
              yield* transact(db, () =>
                application.register((handle) =>
                  Effect.gen(function* () {
                    saved = handle
                    assert.equal(
                      reasonOf(yield* Effect.flip(foreign.validate(handle))),
                      "foreign-source"
                    )
                    assert.equal(
                      reasonOf(yield* Effect.flip(application.validate(db))),
                      "unqualified-handle"
                    )
                    assert.equal(
                      reasonOf(
                        yield* Effect.flip(
                          application.ownedTransaction(() => Effect.void)
                        )
                      ),
                      "active-transaction"
                    )
                  })
                )
              )
              assert.equal(
                reasonOf(yield* Effect.flip(application.validate(saved))),
                "inactive-handle"
              )
              assert(
                (yield* Effect.flip(application.validate({ query() {} }))) instanceof
                  PostgreSqlInvalidHandle
              )
            })
          )
          for (const channel of ["success", "failure", "defect", "interruption"]) {
            yield* check(
              `capability invalidation ${channel}`,
              Effect.gen(function* () {
                let escaped:
                  | Effect.Effect<EnqueueResult, JobEnqueueError | PostgreSqlError>
                  | undefined
                const body = backend.withTransaction((tx) =>
                  Effect.gen(function* () {
                    escaped = definition.enqueue(tx, input(`escaped-${channel}`))
                    if (channel === "failure") {
                      return yield* Effect.fail("caller-error")
                    }
                    if (channel === "defect") {
                      return yield* Effect.die("caller-defect")
                    }
                    if (channel === "interruption") {
                      return yield* Effect.interrupt
                    }
                  })
                )
                const exit = yield* Effect.exit(body)
                if (channel !== "success") {
                  assert(Exit.isFailure(exit))
                }
                if (channel === "failure") {
                  assert(Exit.isFailure(exit))
                  assert(
                    exit.cause.reasons.some(
                      (r) => Cause.isFailReason(r) && r.error === "caller-error"
                    )
                  )
                }
                if (channel === "defect") {
                  assert(Exit.isFailure(exit))
                  assert(
                    exit.cause.reasons.some(
                      (r) => Cause.isDieReason(r) && r.defect === "caller-defect"
                    )
                  )
                }
                if (channel === "interruption") {
                  assert(Exit.isFailure(exit))
                  assert(Cause.hasInterrupts(exit.cause))
                }
                assert(escaped)
                assert.equal((yield* Effect.flip(escaped))._tag, "JobsTransactionClosed")
              })
            )
          }
          yield* check(
            "interruption after all four writes rolls back",
            Effect.gen(function* () {
              const ready = yield* Deferred.make()
              const fiber = yield* Effect.forkChild(
                transact(db, (tx) =>
                  application.register((handle) =>
                    writes("interrupt", tx, handle).pipe(
                      Effect.andThen(Deferred.succeed(ready, undefined)),
                      Effect.andThen(Effect.never)
                    )
                  )
                )
              )
              yield* Deferred.await(ready)
              yield* Fiber.interrupt(fiber)
              assert.deepEqual(yield* Effect.promise(() => count("interrupt")), none)
            })
          )
        })
      ).pipe(
        Effect.provide(
          PgClient.layer({
            host: config.host,
            port: config.port,
            database: config.database,
            username: role,
            password: Redacted.make(secret),
            maxConnections: 2,
            connectTimeout: "500 millis",
            idleTimeout: "1 second",
            startupParameters: {
              statement_timeout: "2000",
              idle_in_transaction_session_timeout: "5000"
            }
          })
        )
      )
    )
    if (Exit.isFailure(exit)) {
      throw new Error(`qualification failed at ${stage}`)
    }
  } finally {
    await observer.end()
  }
} catch {
  process.exitCode = 1
  console.log(`native qualification FAIL at ${stage}; provider details suppressed`)
} finally {
  try {
    if (schemaCreated) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    }
    if (roleCreated) {
      await admin.query(`DROP OWNED BY ${role}`)
      await admin.query(`DROP ROLE ${role}`)
    }
    cleanup = (
      await admin.query(
        `SELECT (SELECT count(*)::int FROM pg_namespace WHERE nspname='${schema}') AS schemas,(SELECT count(*)::int FROM pg_roles WHERE rolname='${role}') AS roles`
      )
    ).rows[0]
    assert.deepEqual(cleanup, { schemas: 0, roles: 0 })
  } finally {
    await admin.end()
  }
  const evidence = {
    runtime: process.versions.bun === undefined ? "node" : "bun",
    runtimeVersion: process.versions.bun ?? process.version,
    drizzle: "1.0.0-rc.5-169397b",
    nativeDriver: "@effect/sql-pg@4.0.0",
    effect: "4.0.0",
    passed,
    stage,
    cleanup,
    success: !process.exitCode
  }
  if (process.env.NATIVE_EVIDENCE_FILE) {
    writeFileSync(
      process.env.NATIVE_EVIDENCE_FILE,
      JSON.stringify(evidence, null, 2) + "\n"
    )
  }
  console.log(JSON.stringify(evidence))
}
