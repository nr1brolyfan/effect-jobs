/** Packed, source-current qualification of the public ambient producer. */
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import { Pool } from "pg"
import { Deferred, Effect, Exit, Fiber, Option, Redacted, Schema } from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Pg from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { pgSchema, text } from "drizzle-orm/pg-core"
import type { SqlError as SqlErrorType } from "effect/sql/SqlError"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import { readQualificationResource } from "../Resource.mjs"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue, JobBackendError } from "effect-jobs/JobEnqueue"
import * as Tables from "effect-jobs/PostgreSqlSchema"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as Payload from "effect-jobs/JobPayload"
import { encodeJobPayload } from "effect-jobs/JobPayloadCodec"

const resource = process.env.D6_RESOURCE_DIRECTORY!
const ownership = readQualificationResource(resource)
const env = Object.fromEntries(
  readFileSync(`${resource}/postgres.env`, "utf8")
    .split("\n")
    .filter((s) => s.includes("="))
    .map((s) => {
      const i = s.indexOf("=")
      return [s.slice(0, i), s.slice(i + 1)]
    })
)
const config = {
  host: "127.0.0.1",
  port: Number(ownership.ports["5432/tcp"][0].HostPort),
  database: env.POSTGRES_DB!,
  user: env.POSTGRES_USER!,
  password: env.POSTGRES_PASSWORD!,
  connectionTimeoutMillis: 500,
  query_timeout: 3000,
  statement_timeout: 2000
}
const schema = "ambient_native"
const mapping = Tables.tables({ schema })
const domain = pgSchema(schema).table("invoices", { id: text("id").primaryKey() })
const definition = Job.make({
  queue: Queue.make("billing"),
  kind: "receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})
const input = (id: string, value = id) => ({
  producer: { operation: "billing.issue", operationId: id, slot: "receipt" },
  policy: Policy.defaultPolicy,
  payload: { invoiceId: value }
})
const admin = new Pool(config)
const checks: string[] = []
const role = "ambient_native_runtime"
let schemaCreated = false
let roleCreated = false
try {
  const secret = randomBytes(24).toString("hex")
  await admin.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
  )
  roleCreated = true
  await admin.query(`CREATE SCHEMA ${schema}`)
  schemaCreated = true
  await admin.query(Tables.migration(mapping))
  await admin.query(
    `CREATE TABLE ${schema}.invoices (id text PRIMARY KEY); ALTER TABLE ${schema}.jobs ADD CHECK(operation_id <> 'fail-job'); GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`
  )
  const count = (id: string) =>
    Effect.promise(
      async () =>
        (
          await admin.query(
            `SELECT (SELECT count(*)::int FROM ${schema}.invoices WHERE id=$1) AS domain,(SELECT count(*)::int FROM ${schema}.jobs WHERE operation_id=$1) AS jobs,(SELECT count(*)::int FROM ${schema}.job_payloads p JOIN ${schema}.jobs j ON j.id=p.job_id WHERE j.operation_id=$1) AS payload`,
            [id]
          )
        ).rows[0]
    )
  const none = { domain: 0, jobs: 0, payload: 0 }
  const all = { domain: 1, jobs: 1, payload: 1 }
  const program = Effect.gen(function* () {
    const client = yield* Pg.PgClient
    const db = yield* Drizzle.makeWithDefaults()
    const adapter = Native.make({ client, operationTimeoutMillis: 2000 })
    const backend = yield* Jobs.make({
      ...mapping,
      operationResponseBudgetMillis: 100
    }).pipe(Effect.provideService(PostgreSqlApplication, adapter))
    yield* backend.ready
    return yield* Effect.gen(function* () {
      type Db = typeof db
      type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
      const transact = <A, E, R>(
        body: (tx: Tx) => Effect.Effect<A, E, R>
      ): Effect.Effect<A, E | SqlErrorType, R> => {
        const invoke: (
          body: (tx: Tx) => Effect.Effect<A, E, R>
        ) => Effect.Effect<A, E | SqlErrorType, R> = db.transaction.bind(db)
        return invoke(body)
      }
      const produce = (id: string, fail = false) =>
        transact((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(domain).values({ id })
            const before = yield* client.unsafe(
              "SELECT pg_backend_pid() AS pid,txid_current()::text AS xid"
            )
            const result = yield* definition.enqueue(input(id))
            const after = yield* client.unsafe(
              "SELECT pg_backend_pid() AS pid,txid_current()::text AS xid"
            )
            assert.deepEqual(before, after)
            if (fail) {
              return yield* Effect.fail("caller-rollback" as const)
            }
            return result
          })
        )
      const joined = (id: string, value = id) =>
        backend.withTransaction(() => definition.enqueue(input(id, value)))
      yield* produce("commit")
      assert.deepEqual(yield* count("commit"), all)
      const rolled = yield* Effect.exit(produce("rollback", true))
      assert(Exit.isFailure(rolled))
      assert.deepEqual(yield* count("rollback"), none)
      checks.push("native Drizzle same connection/xid atomic commit and caller rollback")
      yield* Effect.all([produce("parallel-a"), produce("parallel-b")], {
        concurrency: 2
      })
      assert.deepEqual(yield* count("parallel-a"), all)
      assert.deepEqual(yield* count("parallel-b"), all)
      const matching = yield* Effect.all([joined("duplicate"), joined("duplicate")], {
        concurrency: 2
      })
      assert.equal(matching[0].jobId, matching[1].jobId)
      assert.deepEqual(matching.map((x) => x._tag).sort(), ["AlreadyPresent", "Inserted"])
      const conflict = yield* Effect.all(
        [Effect.exit(joined("conflict", "a")), Effect.exit(joined("conflict", "b"))],
        { concurrency: 2 }
      )
      assert.equal(conflict.filter(Exit.isSuccess).length, 1)
      assert.equal(conflict.filter(Exit.isFailure).length, 1)
      checks.push("parallel isolated transactions and matching/conflicting dedup")
      const absent = yield* Effect.flip(definition.enqueue(input("outside")))
      assert(absent instanceof JobBackendError)
      assert.equal(absent.reason, "transaction-required")
      assert.deepEqual(yield* count("outside"), none)
      // A distinct client's transaction cannot satisfy this configured backend.
      const foreign = yield* Pg.make({ ...client.config, maxConnections: 1 }).pipe(
        Effect.provide(Reactivity.layer)
      )
      const wrong = yield* Effect.flip(
        foreign.withTransaction(definition.enqueue(input("foreign")))
      )
      assert(wrong instanceof JobBackendError)
      assert.equal(wrong.reason, "transaction-required")
      checks.push("no active / foreign client rejection with no implicit transaction")
      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.forkScoped(
        transact((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(domain).values({ id: "interrupted" })
            yield* definition.enqueue(input("interrupted"))
            yield* Deferred.succeed(entered, undefined)
            return yield* Effect.never
          })
        )
      )
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)
      assert.deepEqual(yield* count("interrupted"), none)
      checks.push("caller interruption rolls back domain/job/payload")
      const standalone = yield* definition.enqueueStandalone(input("standalone"))
      assert.equal(standalone._tag, "Inserted")
      assert.deepEqual(yield* count("standalone"), { domain: 0, jobs: 1, payload: 1 })
      const active = yield* transact(() =>
        Effect.flip(definition.enqueueStandalone(input("active")))
      )
      assert(active instanceof JobBackendError)
      assert.equal(active.reason, "active-transaction")
      assert.deepEqual(yield* count("active"), none)
      const failed = yield* Effect.exit(definition.enqueueStandalone(input("fail-job")))
      assert(Exit.isFailure(failed))
      assert.deepEqual(yield* count("fail-job"), none)
      checks.push(
        "standalone acknowledged commit, active rejection and SQL failure rollback"
      )
      // Deterministic after-durable-COMMIT response loss injection on the actual native connection.
      // This is not a real lost-network / server-crash claim.
      const lost = Job.make({
        queue: definition.queue,
        kind: definition.kind,
        payload: definition.payload,
        encodePayload: (schema, value) =>
          Effect.gen(function* () {
            const active = yield* Effect.serviceOption(client.transactionService)
            assert(Option.isSome(active))
            const connection = active.value[0]
            const executeRaw = connection.executeRaw.bind(connection)
            Object.assign(connection, {
              executeRaw: (...args: Parameters<typeof executeRaw>) => {
                if (args[0] !== "COMMIT") {
                  return executeRaw(...args)
                }
                Object.assign(connection, { executeRaw })
                return executeRaw(...args).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new SqlError({
                        reason: new ConnectionError({
                          cause: "synthetic post-commit response loss"
                        })
                      })
                    )
                  )
                )
              }
            })
            return yield* encodeJobPayload(schema, value)
          })
      })
      const unknown = yield* Effect.flip(lost.enqueueStandalone(input("lost-commit")))
      assert(unknown instanceof JobBackendError)
      assert.equal(unknown.commitKnowledge, "Unknown")
      assert.deepEqual(yield* count("lost-commit"), { domain: 0, jobs: 1, payload: 1 })
      checks.push(
        "standalone post-durable-COMMIT synthetic response loss preserves Unknown without replay"
      )
      // Encrypted fingerprint equality is compared by actual storage, across random envelopes.
      const Envelope = Schema.Struct({
        ciphertext: Schema.String,
        nonce: Schema.String,
        tag: Schema.String,
        keyId: Schema.Literals(["old", "current"]),
        fingerprint: Schema.String
      })
      const localKeys = { old: randomBytes(32), current: randomBytes(32) }
      const fingerprintKey = randomBytes(32)
      let keyId: "old" | "current" = "old"
      const protectedJob = Job.make({
        queue: definition.queue,
        kind: "private.receipt",
        payload: Payload.encrypted({
          schema: Schema.String,
          codec: {
            envelope: Envelope,
            seal: (value) =>
              Effect.sync(() => {
                const nonce = randomBytes(12)
                const cipher = createCipheriv("aes-256-gcm", localKeys[keyId], nonce)
                const ciphertext = Buffer.concat([
                  cipher.update(value, "utf8"),
                  cipher.final()
                ])
                return {
                  ciphertext: ciphertext.toString("base64"),
                  nonce: nonce.toString("base64"),
                  tag: cipher.getAuthTag().toString("base64"),
                  keyId,
                  fingerprint: createHmac("sha256", fingerprintKey)
                    .update(value)
                    .digest("hex")
                }
              }),
            open: (envelope) =>
              Effect.try({
                try: () => {
                  const decipher = createDecipheriv(
                    "aes-256-gcm",
                    localKeys[envelope.keyId],
                    Buffer.from(envelope.nonce, "base64")
                  )
                  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
                  return Buffer.concat([
                    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
                    decipher.final()
                  ]).toString("utf8")
                },
                catch: () => new Payload.JobEncryptionError()
              })
          }
        })
      })
      const protectedInput = (payload: string) => ({ ...input("encrypted"), payload })
      const first = yield* protectedJob.enqueueStandalone(protectedInput("same"))
      keyId = "current"
      const equal = yield* protectedJob.enqueueStandalone(protectedInput("same"))
      assert.equal(first.jobId, equal.jobId)
      assert.equal(equal._tag, "AlreadyPresent")
      const stored = yield* Effect.promise(
        async () =>
          (
            await admin.query(
              `SELECT p.payload FROM ${schema}.job_payloads p JOIN ${schema}.jobs j ON j.id=p.job_id WHERE j.operation_id=$1`,
              ["encrypted"]
            )
          ).rows[0].payload as Buffer
      )
      const decoded = yield* Schema.decodeUnknownEffect(protectedJob.payload)(
        JSON.parse(stored.toString("utf8"))
      )
      assert.equal(decoded, "same")
      const changed = yield* Effect.exit(
        protectedJob.enqueueStandalone(protectedInput("changed"))
      )
      assert(Exit.isFailure(changed))
      checks.push(
        "real PostgreSQL AES-GCM nonce/key rotation preserves semantic HMAC dedup and old-key decoding; changed content conflicts"
      )
      return checks
    }).pipe(Effect.provideService(JobEnqueue, backend.producer))
  })
  const result = await Effect.runPromise(
    Effect.scoped(program).pipe(
      Effect.provide(
        Pg.layer({
          host: config.host,
          port: config.port,
          database: config.database,
          username: role,
          password: Redacted.make(secret),
          maxConnections: 4,
          connectTimeout: 500,
          startupParameters: {
            statement_timeout: "2000",
            idle_in_transaction_session_timeout: "5000"
          }
        })
      )
    )
  )
  writeFileSync(
    process.env.AMBIENT_EVIDENCE_FILE!,
    JSON.stringify(
      {
        runtime: process.versions.bun ? "bun" : "node",
        checks: result,
        success: true,
        limits:
          "Pinned native clients only; synthetic response fault, no server/network crash qualification; local AES-GCM/HMAC test keys only, application crypto remains application-owned"
      },
      null,
      2
    ) + "\n"
  )
  console.log(`Public ambient/standalone qualification PASS: ${checks.length} groups`)
} finally {
  if (schemaCreated) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
  }
  if (roleCreated) {
    await admin.query(`DROP ROLE ${role}`)
  }
  await admin.end()
}
