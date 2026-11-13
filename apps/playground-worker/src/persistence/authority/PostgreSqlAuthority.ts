import type { PublicErrorCode } from "@effect-jobs/playground-contracts/Services"
import * as NativeTransaction from "../NativeTransaction.js"
// The application supplies the exact PgClient's SqlClient service and native adapter.
// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Layer, Option, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Pg from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { and, eq } from "drizzle-orm"
import { controls } from "./TransactionControls.js"
import {
  SandboxAuthority,
  PlaygroundError
} from "@effect-jobs/playground-contracts/Services"
import { SandboxView, limits } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import {
  CommandTransactions,
  CommandTransactionFailure
} from "../commands/Transactions.js"
import * as Tables from "./Schema.js"
import * as Mode from "./PrivateMode.js"
import * as Traffic from "../../scenarios/PrivateTraffic.js"
import * as CommandTables from "./CommandTables.js"
import * as CommandRows from "./CommandRows.js"

export const viewerMillis = 15_000
const dbTime = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint"
const fail = (code: PublicErrorCode) => new PlaygroundError({ code })
const digest = (value: string) =>
  Effect.tryPromise({
    try: async () =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
        ),
        (byte) => byte.toString(16).padStart(2, "0")
      ).join(""),
    catch: () => fail("unavailable")
  })
const view = Effect.fnUntraced(function* (row: Record<string, unknown>, local = false) {
  const generation = yield* CommandRows.decodeGeneration(row.generation)
  const expiresAt = yield* CommandRows.decodeMillis(row.expires_at)
  const capacity =
    row.demo_owned === true
      ? undefined
      : {
          mode: local ? ("local" as const) : ("bounded" as const),
          retainedJobs: yield* CommandRows.decodeCount(row.retained_jobs),
          admittedCommands: yield* CommandRows.decodeCount(
            row.admitted_commands === undefined ? 0 : row.admitted_commands
          )
        }
  return yield* Schema.decodeUnknownEffect(SandboxView)(
    {
      ref: { sandboxId: row.sandbox_id, generation },
      expiresAt,
      ...(capacity === undefined ? {} : { capacity }),
      capabilities: {
        runScenario: row.demo_owned !== true,
        resetSandbox: row.demo_owned !== true,
        retryJob: row.demo_owned !== true,
        redriveJob: row.demo_owned !== true,
        cancelJob: row.demo_owned !== true
      }
    },
    { onExcessProperty: "error" }
  ).pipe(Effect.mapError(() => fail("unavailable")))
})

export const make = (schema: string, client: Pg.PgClient) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    if (client !== sql) {
      return yield* new CommandTransactionFailure({ commitKnowledge: "NotCommitted" })
    }
    const db = yield* Drizzle.makeWithDefaults().pipe(
      Effect.provideService(Pg.PgClient, client)
    )
    const tables = CommandTables.make(schema)
    const local = yield* Mode.LocalPrivate
    const retainedMaximum = Mode.retainedMaximum(local)
    const admissionMaximum = Mode.admissionMaximum(local)
    const t = Tables.relations(schema)
    const traffic = yield* Traffic.make(schema)
    const query = (text: string, values: ReadonlyArray<unknown> = []) =>
      sql
        .unsafe<Record<string, unknown>>(text, values)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.failCause(
              Cause.map(
                cause,
                () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
              )
            )
          )
        )
    // Compile only: .toSQL() encodes bound parameters but performs no query or
    // result mapping. The existing same-client query boundary owns execution.
    const typed = (statement: {
      readonly toSQL: () => { readonly sql: string; readonly params: unknown[] }
    }) =>
      Effect.gen(function* () {
        if (Option.isNone(yield* Effect.serviceOption(client.transactionService))) {
          return yield* new CommandTransactionFailure({ commitKnowledge: "NotCommitted" })
        }
        const compiled = yield* Effect.try({
          try: () => statement.toSQL(),
          catch: () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
        })
        return yield* query(compiled.sql, compiled.params)
      })
    const identity = (ref: SandboxRef, requestId: string, operation: string) => ({
      sandboxId: ref.sandboxId,
      generation: ref.generation,
      operation,
      requestId
    })
    const described = (id: string) =>
      query(
        `SELECT s.*,((SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)+(SELECT count(*) FROM "${schema}"."repair_admission" WHERE sandbox_id=s.sandbox_id)) AS admitted_commands FROM ${t.sandboxes} s WHERE sandbox_id=$1`,
        [id]
      )
    const locked = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* query(
          `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
          [id]
        )
        const [clock] = yield* query(`SELECT ${dbTime} AS db_now`)
        return rows.map((row) => ({ ...row, db_now: clock?.db_now }))
      })
    const guard = (rows: ReadonlyArray<Record<string, unknown>>, expected?: SandboxRef) =>
      Effect.gen(function* () {
        const row = rows[0]
        if (!row) {
          return yield* fail("not-found")
        }
        const expiresAt = yield* CommandRows.decodeMillis(row.expires_at)
        const dbNow = yield* CommandRows.decodeMillis(row.db_now)
        const generation = yield* CommandRows.decodeGeneration(row.generation)
        if (expiresAt <= dbNow) {
          return yield* fail("sandbox-expired")
        }
        if (expected && generation !== expected.generation) {
          return yield* fail("stale-generation")
        }
        const guarded: Record<string, unknown> & {
          readonly expires_at: number
          readonly db_now: number
          readonly generation: number
        } = { ...row, expires_at: expiresAt, db_now: dbNow, generation }
        return guarded
      })
    const publicEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.failCause(
            Cause.fromReasons(
              cause.reasons.map((reason): Cause.Reason<PlaygroundError> => {
                if (Cause.isInterruptReason(reason)) {
                  return reason
                }
                if (Cause.isDieReason(reason)) {
                  return Cause.makeDieReason(new Error("Sandbox authority defect"))
                }
                return Cause.makeFailReason(
                  fail(
                    reason.error instanceof PlaygroundError
                      ? reason.error.code
                      : "unavailable"
                  )
                )
              })
            )
          )
        )
      )
    const renew = (access: SandboxAccess) =>
      NativeTransaction.withTransaction(
        sql,
        Effect.gen(function* () {
          const row = yield* guard(
            yield* locked(access.sandbox.ref.sandboxId),
            access.sandbox.ref
          )
          yield* query(
            `UPDATE ${t.sandboxes} SET viewer_until=LEAST(expires_at,$2::bigint+$3::bigint) WHERE sandbox_id=$1`,
            [row.sandbox_id, row.db_now, viewerMillis]
          )
          if (row.demo_owned !== true) {
            yield* traffic.ensure((yield* view(row, local)).ref, Number(row.db_now)).pipe(
              Effect.catchTags({
                PlaygroundError: (error) =>
                  error.code === "limit-reached" ? Effect.void : Effect.fail(error)
              })
            )
          }
          return yield* view((yield* described(String(row.sandbox_id)))[0]!, local)
        })
      ).pipe(publicEffect)
    const authority = SandboxAuthority.of({
      issue: () =>
        Effect.gen(function* () {
          const credential = yield* Effect.sync(() =>
            Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
              byte.toString(16).padStart(2, "0")
            ).join("")
          )
          const hash = yield* digest(credential)
          const id = yield* Effect.sync(() => crypto.randomUUID())
          return yield* NativeTransaction.withTransaction(
            sql,
            Effect.gen(function* () {
              const rows = yield* query(
                `INSERT INTO ${t.sandboxes}(sandbox_id,generation,expires_at,credential_hash,viewer_until,next_generation_at)
        VALUES ($1,1,${dbTime}+$3::bigint,$2,${dbTime}+$4::bigint,${dbTime}+5000) RETURNING *,${dbTime} AS db_now`,
                [id, hash, limits.sandboxLifetimeMillis, viewerMillis]
              )
              yield* traffic.ensure(
                (yield* view(rows[0]!, local)).ref,
                Number(rows[0]!.db_now)
              )
              const [created] = yield* described(id)
              return {
                sandbox: yield* view(created!, local),
                credential: Redacted.make(credential)
              }
            })
          )
        }).pipe(publicEffect),
      authenticate: (credential) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f]{64}$/.test(Redacted.value(credential))) {
            return yield* fail("not-found")
          }
          const hash = yield* digest(Redacted.value(credential))
          const row = yield* guard(
            yield* query(
              `SELECT s.*,${dbTime} AS db_now,((SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)+(SELECT count(*) FROM "${schema}"."repair_admission" WHERE sandbox_id=s.sandbox_id)) AS admitted_commands FROM ${t.sandboxes} s WHERE credential_hash=$1`,
              [hash]
            )
          )
          return { sandbox: yield* view(row, local) }
        }).pipe(publicEffect),
      describe: renew
    })
    const receipt = (ref: SandboxRef, requestId: string, operation: string) =>
      typed(
        db
          .select({ receipt: tables.receipts.receipt })
          .from(tables.receipts)
          .where(
            and(
              eq(tables.receipts.sandboxId, ref.sandboxId),
              eq(tables.receipts.generation, ref.generation),
              eq(tables.receipts.operation, operation),
              eq(tables.receipts.requestId, requestId)
            )
          )
      ).pipe(Effect.flatMap(CommandRows.decodeReceiptRows))
    const transactions = CommandTransactions.of({
      owned: (access, request, operation, body) =>
        Effect.gen(function* () {
          if (Option.isSome(yield* Effect.serviceOption(sql.transactionService))) {
            return yield* new CommandTransactionFailure({
              commitKnowledge: "NotCommitted"
            })
          }
          if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
            return yield* fail("not-found")
          }
          // Persist first admission separately. Receipt absence NEVER grants write replay.
          const fresh = yield* controls(
            NativeTransaction.withTransaction(
              sql,
              Effect.gen(function* () {
                const admitted = yield* guard(yield* locked(request.sandbox.sandboxId))
                if (admitted.demo_owned === true) {
                  return yield* fail("capability-unavailable")
                }
                const prior = yield* typed(
                  db
                    .select({ request_id: tables.admission.requestId })
                    .from(tables.admission)
                    .where(
                      and(
                        eq(tables.admission.sandboxId, request.sandbox.sandboxId),
                        eq(tables.admission.generation, request.sandbox.generation),
                        eq(tables.admission.operation, operation),
                        eq(tables.admission.requestId, request.requestId)
                      )
                    )
                )
                if ((yield* CommandRows.decodeAdmissionRows(prior)).length) {
                  return false
                }
                const [budget] = yield* query(
                  `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
                  [request.sandbox.sandboxId]
                )
                if ((yield* CommandRows.decodeCount(budget?.n)) >= admissionMaximum) {
                  return yield* fail("limit-reached")
                }
                const inserted = yield* typed(
                  db
                    .insert(tables.admission)
                    .values(identity(request.sandbox, request.requestId, operation))
                    .onConflictDoNothing()
                    .returning({ request_id: tables.admission.requestId })
                )
                return (yield* CommandRows.decodeAdmissionRows(inserted)).length === 1
              })
            )
          )
          return yield* controls(
            NativeTransaction.withTransaction(
              sql,
              Effect.gen(function* () {
                const row = yield* guard(yield* locked(request.sandbox.sandboxId))
                if (
                  request.requestId.startsWith("auto-") &&
                  (yield* CommandRows.decodeCount(row.viewer_until)) <= row.db_now
                ) {
                  return yield* fail("sandbox-expired")
                }
                if (row.demo_owned === true) {
                  return yield* fail("capability-unavailable")
                }
                const current = (yield* view(row, local)).ref
                return yield* body({
                  admission: fresh ? "Fresh" : "Unresolved",
                  current,
                  dbNow: row.db_now,
                  expiresAt: row.expires_at,
                  receipt: (req, op) => receipt(req.sandbox, req.requestId, op),
                  reserve: (count) =>
                    Effect.gen(function* () {
                      if (!Number.isInteger(count) || count < 1 || count > 10) {
                        return yield* fail("limit-reached")
                      }
                      const reserved = yield* query(
                        `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+$2::int
              WHERE sandbox_id=$1 AND retained_jobs<=${retainedMaximum}-$2::int RETURNING sandbox_id`,
                        [current.sandboxId, count]
                      )
                      if (!reserved.length) {
                        return yield* fail("limit-reached")
                      }
                    }),
                  associate: (jobId, job) =>
                    typed(
                      db.insert(tables.associations).values({
                        sandboxId: current.sandboxId,
                        generation: current.generation,
                        jobId,
                        relations: {
                          syntheticActor: job.payload.actor,
                          syntheticTenant: job.payload.tenant,
                          syntheticOrderId: job.payload.order
                        }
                      })
                    ).pipe(Effect.asVoid),
                  advanceGeneration: (expected) =>
                    Effect.gen(function* () {
                      // Reset retains all evidence and seeds the same sandbox's new generation.
                      const [capacity] = yield* query(
                        `SELECT retained_jobs,(SELECT count(*) FROM ${t.admission} WHERE sandbox_id=$1) AS admissions FROM ${t.sandboxes} WHERE sandbox_id=$1`,
                        [expected.sandboxId]
                      )
                      if (
                        (yield* CommandRows.decodeCount(capacity?.retained_jobs)) >
                          retainedMaximum - Traffic.starterCount ||
                        (yield* CommandRows.decodeCount(capacity?.admissions)) >=
                          admissionMaximum
                      ) {
                        return yield* fail("limit-reached")
                      }
                      const updated = yield* query(
                        `UPDATE ${t.sandboxes} SET generation=generation+1, next_generation_at=${dbTime}+5000
              WHERE sandbox_id=$1 AND generation=$2 AND generation<9007199254740991 RETURNING *`,
                        [expected.sandboxId, expected.generation]
                      )
                      if (!updated.length) {
                        return yield* fail("stale-generation")
                      }
                      const advanced = (yield* view(updated[0]!, local)).ref
                      yield* traffic.ensure(advanced, Number(row.db_now))
                      return advanced
                    }),
                  saveReceipt: (value) =>
                    typed(
                      db.insert(tables.receipts).values({
                        ...identity(request.sandbox, request.requestId, operation),
                        receipt: value
                      })
                    ).pipe(Effect.asVoid),
                  audit: (entry) =>
                    query(`INSERT INTO ${t.audit} VALUES ($1,$2,$3,$4,$5,${dbTime})`, [
                      current.sandboxId,
                      current.generation,
                      entry.operation,
                      entry.reason,
                      entry.count
                    ]).pipe(Effect.asVoid)
                })
              })
            )
          )
        }),
      lookup: (access, request, operation) =>
        controls(
          NativeTransaction.withTransaction(
            sql,
            Effect.gen(function* () {
              if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
                return yield* fail("not-found")
              }
              const row = yield* guard(yield* locked(request.sandbox.sandboxId))
              if (request.sandbox.generation > Number(row.generation)) {
                return yield* fail("stale-generation")
              }
              return yield* receipt(request.sandbox, request.requestId, operation)
            })
          )
        )
    })
    return { authority, transactions }
  })
export const authorityLayerNoDeps = (schema: string) =>
  Layer.effect(
    SandboxAuthority,
    Pg.PgClient.pipe(
      Effect.flatMap((client) => make(schema, client)),
      Effect.map((services) => services.authority)
    )
  )
export const transactionsLayerNoDeps = (schema: string) =>
  Layer.effect(
    CommandTransactions,
    Pg.PgClient.pipe(
      Effect.flatMap((client) => make(schema, client)),
      Effect.map((services) => services.transactions)
    )
  )
