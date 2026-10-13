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
import * as Mode from "./PrivateMode.js"
import * as Traffic from "../../scenarios/PrivateTraffic.js"

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
const view = (row: Record<string, unknown>, local = false) =>
  Schema.decodeUnknownEffect(SandboxView)(
    {
      ref: { sandboxId: row.sandbox_id, generation: Number(row.generation) },
      expiresAt: Number(row.expires_at),
      ...(row.demo_owned === true
        ? {}
        : {
            capacity: {
              mode: local ? "local" : "bounded",
              retainedJobs: Number(row.retained_jobs),
              admittedCommands: Number(row.admitted_commands ?? 0)
            }
          }),
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

export const make = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const local = yield* Mode.LocalPrivate
    const retainedMaximum = Mode.retainedMaximum(local)
    const admissionMaximum = Mode.admissionMaximum(local)
    const t = Tables.relations(schema)
    const traffic = yield* Traffic.make(schema)
    const query = (text: string, values: ReadonlyArray<unknown> = []) =>
      sql
        .unsafe<Record<string, unknown>>(text, values)
        .pipe(
          Effect.mapError(
            () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
          )
        )
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
            if (row.demo_owned !== true) {
              yield* traffic
                .ensure((yield* view(row, local)).ref, Number(row.db_now))
                .pipe(
                  Effect.catchTag("PlaygroundError", (error) =>
                    error.code === "limit-reached" ? Effect.void : Effect.fail(error)
                  )
                )
            }
            return yield* view((yield* described(String(row.sandbox_id)))[0]!, local)
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
          return yield* sql.withTransaction(
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
                const admitted = yield* guard(yield* locked(request.sandbox.sandboxId))
                if (admitted.demo_owned === true) {
                  return yield* fail("capability-unavailable")
                }
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
                  `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
                  [request.sandbox.sandboxId]
                )
                if (Number(budget!.n) >= admissionMaximum) {
                  return yield* fail("limit-reached")
                }
                const inserted = yield* query(
                  `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_id`,
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
                if (row.demo_owned === true) {
                  return yield* fail("capability-unavailable")
                }
                const current = (yield* view(row, local)).ref
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
              WHERE sandbox_id=$1 AND retained_jobs<=${retainedMaximum}-$2::int RETURNING sandbox_id`,
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
                        syntheticTenant: job.payload.tenant,
                        syntheticOrderId: job.payload.order
                      })
                    ]).pipe(Effect.asVoid),
                  advanceGeneration: (expected) =>
                    Effect.gen(function* () {
                      // Reset retains all evidence and seeds the same sandbox's new generation.
                      const [capacity] = yield* query(
                        `SELECT retained_jobs,(SELECT count(*) FROM ${t.admission} WHERE sandbox_id=$1) AS admissions FROM ${t.sandboxes} WHERE sandbox_id=$1`,
                        [expected.sandboxId]
                      )
                      if (
                        Number(capacity!.retained_jobs) >
                          retainedMaximum - Traffic.starterCount ||
                        Number(capacity!.admissions) >= admissionMaximum
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
