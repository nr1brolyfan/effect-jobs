// @effect-diagnostics unstableApiUsage:off
import { Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { controls } from "./TransactionControls.js"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { SandboxRef, type SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  commandIdentity,
  matchesCommandResult,
  JobOperatorCommand,
  JobOperatorReceiptRequest
} from "@effect-jobs/playground-contracts/Operators"
import {
  OperatorTransactions,
  StoredOperatorReceipt
} from "../commands/OperatorTransactions.js"
import { CommandTransactionFailure } from "../commands/Transactions.js"
import * as Mode from "./PrivateMode.js"
import * as Tables from "./Schema.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const sameRef = (a: SandboxRef, b: SandboxRef) =>
  a.sandboxId === b.sandboxId && a.generation === b.generation
const dbTime = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint"
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown
) =>
  Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => fail("unavailable"))
  )

export const make = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const local = yield* Mode.LocalPrivate
    const retainedMaximum = Mode.retainedMaximum(local)
    const admissionMaximum = Mode.admissionMaximum(local)
    const t = Tables.relations(schema)
    const lineage = `"${schema}"."operator_redrives"`
    const payloads = `"${schema}"."job_payloads"`
    const query = (text: string, values: ReadonlyArray<unknown> = []) =>
      sql
        .unsafe<Record<string, unknown>>(text, values)
        .pipe(
          Effect.mapError(
            () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
          )
        )
    const lock = (access: SandboxAccess, ref: SandboxRef) =>
      Effect.gen(function* () {
        if (access.sandbox.ref.sandboxId !== ref.sandboxId) {
          return yield* fail("not-found")
        }
        const [row] = yield* query(
          `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
          [ref.sandboxId]
        )
        if (!row) {
          return yield* fail("not-found")
        }
        if (row.demo_owned === true) {
          return yield* fail("capability-unavailable")
        }
        const [clock] = yield* query(`SELECT ${dbTime} AS now`)
        if (Number(row.expires_at) <= Number(clock!.now)) {
          return yield* fail("sandbox-expired")
        }
        const current = yield* decode(SandboxRef, {
          sandboxId: row.sandbox_id,
          generation: Number(row.generation)
        })
        if (ref.generation > current.generation) {
          return yield* fail("stale-generation")
        }
        return { row, current }
      })
    const receipt = (request: JobOperatorReceiptRequest) =>
      Effect.gen(function* () {
        const [row] = yield* query(
          `SELECT receipt FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation='Operator' AND request_id=$3`,
          [request.sandbox.sandboxId, request.sandbox.generation, request.requestId]
        )
        if (!row) {
          return null
        }
        const stored = yield* decode(StoredOperatorReceipt, row.receipt)
        if (
          !sameRef(stored.command.sandbox, request.sandbox) ||
          !sameRef(stored.result.sandbox, request.sandbox) ||
          stored.command.requestId !== request.requestId ||
          stored.result.requestId !== request.requestId ||
          stored.command.action !== stored.result.action ||
          (stored.result._tag === "Rejected" &&
            stored.result.jobId !== stored.command.jobId) ||
          (stored.result._tag === "Committed" &&
            (stored.result.sourceJobId !== stored.command.jobId ||
              stored.result.sourceState !== stored.command.expectedState ||
              stored.result.sourceLifecycleVersion !==
                stored.command.expectedLifecycleVersion))
        ) {
          return yield* fail("unavailable")
        }
        return stored
      })
    return OperatorTransactions.of({
      owned: (access, input, body) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(JobOperatorCommand)(input, {
            onExcessProperty: "error"
          }).pipe(Effect.mapError(() => fail("invalid-request")))
          if (Option.isSome(yield* Effect.serviceOption(sql.transactionService))) {
            return yield* new CommandTransactionFailure({
              commitKnowledge: "NotCommitted"
            })
          }
          const identity = commandIdentity(command)
          // Persistent first admission is a separate acknowledged transaction. A
          // duplicate unresolved request can only look up its receipt, never execute.
          const fresh = yield* controls(
            sql.withTransaction(
              Effect.gen(function* () {
                const { current } = yield* lock(access, command.sandbox)
                const [prior] = yield* query(
                  `SELECT operator_command FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation='Operator' AND request_id=$3`,
                  [
                    command.sandbox.sandboxId,
                    command.sandbox.generation,
                    command.requestId
                  ]
                )
                if (prior) {
                  if (prior.operator_command !== identity) {
                    return yield* fail("invalid-request")
                  }
                  return false
                }
                if (!sameRef(current, command.sandbox)) {
                  return yield* fail("stale-generation")
                }
                const [budget] = yield* query(
                  `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
                  [current.sandboxId]
                )
                if (Number(budget!.n) >= admissionMaximum) {
                  return yield* fail("limit-reached")
                }
                yield* query(
                  `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id,operator_command) VALUES ($1,$2,'Operator',$3,$4)`,
                  [current.sandboxId, current.generation, command.requestId, identity]
                )
                return true
              })
            )
          )
          return yield* controls(
            sql.withTransaction(
              Effect.gen(function* () {
                const { row, current } = yield* lock(access, command.sandbox)
                const stored = yield* receipt(command)
                if (stored && commandIdentity(stored.command) !== identity) {
                  return yield* fail("invalid-request")
                }
                const assertCurrent = Effect.gen(function* () {
                  if (!sameRef(current, command.sandbox)) {
                    return yield* fail("stale-generation")
                  }
                  const [clock] = yield* query(`SELECT ${dbTime} AS now`)
                  if (Number(row.expires_at) <= Number(clock!.now)) {
                    return yield* fail("sandbox-expired")
                  }
                })
                let source: Readonly<Record<string, unknown>> | null | undefined
                const scopedSource = Effect.gen(function* () {
                  yield* assertCurrent
                  if (!fresh || stored !== null) {
                    return yield* fail("unavailable")
                  }
                  if (source !== undefined) {
                    return source
                  }
                  const [found] = yield* query(
                    `SELECT j.*,p.format_version,p.payload,p.projection,a.relations
            FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id
            LEFT JOIN ${payloads} p ON p.job_id=j.id
            WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
                    [current.sandboxId, current.generation, command.jobId]
                  )
                  source = found ?? null
                  return source
                })
                const result = yield* body({
                  admission: fresh ? "Fresh" : "Unresolved",
                  stored,
                  assertCurrent,
                  source: () => scopedSource,
                  associateRedrive: (accepted) =>
                    Effect.gen(function* () {
                      yield* assertCurrent
                      if (
                        accepted.action !== "redrive" ||
                        command.action !== "redrive" ||
                        accepted.sourceJobId !== command.jobId ||
                        accepted.resultJobId === command.jobId ||
                        !sameRef(accepted.sandbox, command.sandbox) ||
                        accepted.requestId !== command.requestId ||
                        accepted.sourceState !== command.expectedState ||
                        accepted.sourceLifecycleVersion !==
                          command.expectedLifecycleVersion
                      ) {
                        return yield* fail("unavailable")
                      }
                      const original = yield* scopedSource
                      if (!original) {
                        return yield* fail("not-found")
                      }
                      const reserved = yield* query(
                        `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<${retainedMaximum} RETURNING sandbox_id`,
                        [current.sandboxId]
                      )
                      if (reserved.length !== 1) {
                        return yield* fail("limit-reached")
                      }
                      yield* query(
                        `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES ($1,$2,$3,$4::jsonb)`,
                        [
                          current.sandboxId,
                          current.generation,
                          accepted.resultJobId,
                          JSON.stringify(original.relations)
                        ]
                      )
                      // Receipt is inserted by save before lineage so the restrictive FK
                      // protects both association links and exact historical acceptance.
                    }),
                  save: (accepted) =>
                    Effect.gen(function* () {
                      yield* assertCurrent
                      if (!matchesCommandResult(command, accepted)) {
                        return yield* fail("unavailable")
                      }
                      const value = yield* decode(StoredOperatorReceipt, {
                        command,
                        result: accepted
                      })
                      if (stored || !fresh) {
                        return yield* fail("unavailable")
                      }
                      yield* query(
                        `INSERT INTO ${t.receipts}(sandbox_id,generation,operation,request_id,receipt) VALUES ($1,$2,'Operator',$3,$4::jsonb)`,
                        [
                          current.sandboxId,
                          current.generation,
                          command.requestId,
                          JSON.stringify(value)
                        ]
                      )
                      if (accepted._tag === "Committed") {
                        yield* query(
                          `INSERT INTO ${t.audit}(sandbox_id,generation,operation,reason,count,observed_at) VALUES ($1,$2,'Operator',$3,$4,$5)`,
                          [
                            current.sandboxId,
                            current.generation,
                            accepted.action,
                            accepted.action === "redrive" ? 1 : 0,
                            accepted.observedAt
                          ]
                        )
                        if (accepted.action === "redrive") {
                          yield* query(
                            `INSERT INTO ${lineage}(sandbox_id,generation,request_id,source_job_id,source_state,source_lifecycle_version,successor_job_id,observed_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                            [
                              current.sandboxId,
                              current.generation,
                              command.requestId,
                              accepted.sourceJobId,
                              accepted.sourceState,
                              accepted.sourceLifecycleVersion,
                              accepted.resultJobId,
                              accepted.observedAt
                            ]
                          )
                        }
                      }
                    })
                })
                // No historical lookup causes new writes. Fresh acceptance/rejection
                // rechecks DB-time expiry immediately before the owner commits.
                if (fresh) {
                  yield* assertCurrent
                }
                return result
              })
            )
          )
        }),
      lookup: (access, input) =>
        controls(
          sql.withTransaction(
            Effect.gen(function* () {
              const request = yield* Schema.decodeUnknownEffect(
                JobOperatorReceiptRequest
              )(input, { onExcessProperty: "error" }).pipe(
                Effect.mapError(() => fail("invalid-request"))
              )
              yield* lock(access, request.sandbox)
              return yield* receipt(request)
            })
          )
        )
    })
  })
export const layerNoDeps = (schema: string) =>
  Layer.effect(OperatorTransactions, make(schema))
