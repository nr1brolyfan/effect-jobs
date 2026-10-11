// The application supplies the exact PgClient's SqlClient service and native adapter.
// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Layer, Option, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { isSqlError, type SqlError } from "effect/sql/SqlError"
import {
  SandboxAuthority,
  PlaygroundError
} from "@effect-jobs/playground-contracts/Services"
import { SandboxView, limits } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import {
  CommandTransactions,
  CommandTransactionFailure,
  StoredReceipt
} from "../commands/Transactions.js"
import * as Tables from "./Schema.js"

export const viewerMillis = 15_000
const dbTime = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint"
const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const controls = <A, E, R>(effect: Effect.Effect<A, E | SqlError, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<E | CommandTransactionFailure>(
          cause.reasons.map((reason) => {
            if (
              (Cause.isFailReason(reason) && isSqlError(reason.error)) ||
              (Cause.isDieReason(reason) && isSqlError(reason.defect))
            ) {
              return Cause.makeFailReason(
                new CommandTransactionFailure({ commitKnowledge: "Unknown" })
              )
            }
            return reason as Cause.Reason<E>
          })
        )
      )
    )
  )
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
const view = (row: Record<string, unknown>) =>
  Schema.decodeUnknownEffect(SandboxView)(
    {
      ref: { sandboxId: row.sandbox_id, generation: Number(row.generation) },
      expiresAt: Number(row.expires_at),
      capabilities: {
        runScenario: true,
        resetSandbox: true,
        retryJob: false,
        redriveJob: false,
        cancelJob: false
      }
    },
    { onExcessProperty: "error" }
  ).pipe(Effect.mapError(() => fail("unavailable")))

export const make = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = Tables.relations(schema)
    const query = (text: string, values: ReadonlyArray<unknown> = []) =>
      sql
        .unsafe<Record<string, unknown>>(text, values)
        .pipe(
          Effect.mapError(
            () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
          )
        )
    const locked = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* query(
          `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
          [id]
        )
        const [clock] = yield* query(`SELECT ${dbTime} AS db_now`)
        return rows.map((row) => ({ ...row, db_now: clock!.db_now }))
      })
    const guard = (rows: ReadonlyArray<Record<string, unknown>>, expected?: SandboxRef) =>
      Effect.gen(function* () {
        const row = rows[0]
        if (!row) {
          return yield* fail("not-found")
        }
        if (Number(row.expires_at) <= Number(row.db_now)) {
          return yield* fail("sandbox-expired")
        }
        if (expected && Number(row.generation) !== expected.generation) {
          return yield* fail("stale-generation")
        }
        return row
      })
    const publicEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError((error) =>
          error instanceof PlaygroundError ? error : fail("unavailable")
        )
      )
    const renew = (access: SandboxAccess) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const row = yield* guard(
              yield* locked(access.sandbox.ref.sandboxId),
              access.sandbox.ref
            )
            yield* query(
              `UPDATE ${t.sandboxes} SET viewer_until=LEAST(expires_at,$2::bigint+$3::bigint) WHERE sandbox_id=$1`,
              [row.sandbox_id, row.db_now, viewerMillis]
            )
            return yield* view(row)
          })
        )
        .pipe(publicEffect)
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
          const rows = yield* query(
            `INSERT INTO ${t.sandboxes}(sandbox_id,generation,expires_at,credential_hash,viewer_until,next_generation_at)
        VALUES ($1,1,${dbTime}+$3::bigint,$2,${dbTime}+$4::bigint,${dbTime}+5000) RETURNING *`,
            [id, hash, limits.sandboxLifetimeMillis, viewerMillis]
          )
          return { sandbox: yield* view(rows[0]!), credential: Redacted.make(credential) }
        }).pipe(publicEffect),
      authenticate: (credential) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f]{64}$/.test(Redacted.value(credential))) {
            return yield* fail("not-found")
          }
          const hash = yield* digest(Redacted.value(credential))
          const row = yield* guard(
            yield* query(
              `SELECT *,${dbTime} AS db_now FROM ${t.sandboxes} WHERE credential_hash=$1`,
              [hash]
            )
          )
          return { sandbox: yield* view(row) }
        }).pipe(publicEffect),
      describe: renew
    })
    const receipt = (ref: SandboxRef, requestId: string, operation: string) =>
      query(
        `SELECT receipt FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
        [ref.sandboxId, ref.generation, operation, requestId]
      ).pipe(
        Effect.flatMap((rows) =>
          rows[0]
            ? Schema.decodeUnknownEffect(StoredReceipt)(rows[0].receipt, {
                onExcessProperty: "error"
              }).pipe(Effect.mapError(() => fail("unavailable")))
            : Effect.succeed(null)
        )
      )
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
            sql.withTransaction(
              Effect.gen(function* () {
                yield* guard(yield* locked(request.sandbox.sandboxId))
                const prior = yield* query(
                  `SELECT request_id FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
                  [
                    request.sandbox.sandboxId,
                    request.sandbox.generation,
                    operation,
                    request.requestId
                  ]
                )
                if (prior.length) {
                  return false
                }
                const [budget] = yield* query(
                  `SELECT count(*)::int AS n FROM ${t.admission} WHERE sandbox_id=$1`,
                  [request.sandbox.sandboxId]
                )
                if (Number(budget!.n) >= 200) {
                  return yield* fail("limit-reached")
                }
                const inserted = yield* query(
                  `INSERT INTO ${t.admission} VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_id`,
                  [
                    request.sandbox.sandboxId,
                    request.sandbox.generation,
                    operation,
                    request.requestId
                  ]
                )
                return inserted.length === 1
              })
            )
          )
          return yield* controls(
            sql.withTransaction(
              Effect.gen(function* () {
                const row = yield* guard(yield* locked(request.sandbox.sandboxId))
                if (
                  request.requestId.startsWith("auto-") &&
                  Number(row.viewer_until) <= Number(row.db_now)
                ) {
                  return yield* fail("sandbox-expired")
                }
                const current = (yield* view(row)).ref
                return yield* body({
                  admission: fresh ? "Fresh" : "Unresolved",
                  current,
                  dbNow: Number(row.db_now),
                  expiresAt: Number(row.expires_at),
                  receipt: (req, op) => receipt(req.sandbox, req.requestId, op),
                  reserve: (count) =>
                    Effect.gen(function* () {
                      if (!Number.isInteger(count) || count < 1 || count > 10) {
                        return yield* fail("limit-reached")
                      }
                      const reserved = yield* query(
                        `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+$2::int
              WHERE sandbox_id=$1 AND retained_jobs+$2::int<=100 RETURNING sandbox_id`,
                        [current.sandboxId, count]
                      )
                      if (!reserved.length) {
                        return yield* fail("limit-reached")
                      }
                    }),
                  associate: (jobId, job) =>
                    query(`INSERT INTO ${t.associations} VALUES ($1,$2,$3,$4::jsonb)`, [
                      current.sandboxId,
                      current.generation,
                      jobId,
                      JSON.stringify({
                        syntheticActor: job.payload.actor,
                        syntheticOrderId: job.payload.order
                      })
                    ]).pipe(Effect.asVoid),
                  advanceGeneration: (expected) =>
                    Effect.gen(function* () {
                      const updated = yield* query(
                        `UPDATE ${t.sandboxes} SET generation=generation+1, next_generation_at=${dbTime}+5000
              WHERE sandbox_id=$1 AND generation=$2 AND generation<9007199254740991 RETURNING *`,
                        [expected.sandboxId, expected.generation]
                      )
                      if (!updated.length) {
                        return yield* fail("stale-generation")
                      }
                      return (yield* view(updated[0]!)).ref
                    }),
                  saveReceipt: (value) =>
                    query(`INSERT INTO ${t.receipts} VALUES ($1,$2,$3,$4,$5::jsonb)`, [
                      request.sandbox.sandboxId,
                      request.sandbox.generation,
                      operation,
                      request.requestId,
                      JSON.stringify(value)
                    ]).pipe(Effect.asVoid),
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
          sql.withTransaction(
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
    make(schema).pipe(Effect.map((services) => services.authority))
  )
export const transactionsLayerNoDeps = (schema: string) =>
  Layer.effect(
    CommandTransactions,
    make(schema).pipe(Effect.map((services) => services.transactions))
  )
