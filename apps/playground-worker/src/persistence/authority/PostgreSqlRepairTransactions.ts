// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { controls } from "./TransactionControls.js"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { SandboxRef, type SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  JobRepairCommand,
  JobResolutionCommand,
  JobRepairReceiptRequest,
  JobRepairResult,
  JobResolutionResult,
  type JobProblem
} from "@effect-jobs/playground-contracts/Repairs"
import {
  RepairTransactions,
  SyntheticRepairTransactions,
  StoredRepairReceipt,
  type RepairCommand
} from "../commands/RepairTransactions.js"
import { CommandTransactionFailure } from "../commands/Transactions.js"
import * as RepairSchema from "../commands/RepairSchema.js"
import * as Reconciliation from "../../execution/RepairReconciliation.js"
import * as Mode from "./PrivateMode.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const sameRef = (a: SandboxRef, b: SandboxRef) =>
  a.sandboxId === b.sandboxId && a.generation === b.generation
const clock = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint"
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown
) =>
  Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => fail("unavailable"))
  )

// The trusted seed adapter is a separate Layer/capability. There is no boolean
// or actor flag on public methods, requests or service commands.
const makeAdapter = (schema: string, category: "LocalOperator" | "SyntheticSeed") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const local = yield* Mode.LocalPrivate
    const t = RepairSchema.relations(schema)
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
        if (category === "LocalOperator" && (!local || row.demo_owned === true)) {
          return yield* fail("not-found")
        }
        if (category === "SyntheticSeed" && row.demo_owned !== true) {
          return yield* fail("not-found")
        }
        const [time] = yield* query(`SELECT ${clock} AS now`)
        if (Number(row.expires_at) <= Number(time!.now)) {
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
    const lookup = (
      request: JobRepairReceiptRequest,
      operation: "Repair" | "Resolution"
    ) =>
      Effect.gen(function* () {
        const [row] = yield* query(
          `SELECT receipt,command_digest FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
          [
            request.sandbox.sandboxId,
            request.sandbox.generation,
            operation,
            request.requestId
          ]
        )
        if (!row) {
          return null
        }
        const stored = yield* decode(StoredRepairReceipt, row.receipt)
        yield* decode(
          operation === "Repair" ? JobRepairResult : JobResolutionResult,
          stored.result
        )
        if (
          stored.commandDigest !== row.command_digest ||
          !sameRef(stored.result.sandbox, request.sandbox) ||
          stored.result.requestId !== request.requestId
        ) {
          return yield* fail("unavailable")
        }
        return stored
      })
    return RepairTransactions.of({
      owned: (access, input, digest, body) =>
        Effect.gen(function* () {
          const command: RepairCommand = yield* decode(
            Schema.Union([JobRepairCommand, JobResolutionCommand]),
            input
          )
          if (!/^[a-f0-9]{64}$/u.test(digest)) {
            return yield* fail("invalid-request")
          }
          if (Option.isSome(yield* Effect.serviceOption(sql.transactionService))) {
            return yield* new CommandTransactionFailure({
              commitKnowledge: "NotCommitted"
            })
          }
          const repair = "jobId" in command
          const operation = repair ? "Repair" : "Resolution"
          const ref = command.sandbox
          const args = [ref.sandboxId, ref.generation, operation, command.requestId]
          // Separately acknowledged immutable admission. Never claim a missing
          // receipt means rollback or authorizes execution on the next request.
          const admission = yield* controls(
            sql.withTransaction(
              Effect.gen(function* () {
                const { current, row } = yield* lock(access, ref)
                const [prior] = yield* query(
                  `SELECT command_digest,actor_category FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
                  args
                )
                if (prior) {
                  return prior.command_digest === digest &&
                    prior.actor_category === category
                    ? ("Unresolved" as const)
                    : ("Conflict" as const)
                }
                if (!sameRef(current, ref)) {
                  return yield* fail("stale-generation")
                }
                const [budget] = yield* query(
                  `SELECT (SELECT count(*) FROM ${t.admission} WHERE sandbox_id=$1)+(SELECT count(*) FROM "${schema}"."command_admission" WHERE sandbox_id=$1) AS n`,
                  [ref.sandboxId]
                )
                const maximum =
                  category === "SyntheticSeed" ? 40000 : Mode.admissionMaximum(local)
                if (Number(budget!.n) >= maximum) {
                  return yield* fail("limit-reached")
                }
                yield* query(
                  `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id,command_digest,actor_category) VALUES ($1,$2,$3,$4,$5,$6)`,
                  [...args, digest, category]
                )
                const [final] = yield* query(`SELECT ${clock} AS now`)
                if (Number(row.expires_at) <= Number(final!.now)) {
                  return yield* fail("sandbox-expired")
                }
                return "Fresh" as const
              })
            )
          )
          return yield* controls(
            sql.withTransaction(
              Effect.gen(function* () {
                const { current, row } = yield* lock(access, ref)
                const stored =
                  admission === "Conflict" ? null : yield* lookup(command, operation)
                if (stored && stored.commandDigest !== digest) {
                  return yield* fail("unavailable")
                }
                const assertCurrent = Effect.gen(function* () {
                  if (!sameRef(current, ref)) {
                    return yield* fail("stale-generation")
                  }
                  const [time] = yield* query(`SELECT ${clock} AS now`)
                  if (Number(row.expires_at) <= Number(time!.now)) {
                    return yield* fail("sandbox-expired")
                  }
                })
                let root: string | undefined
                let source: Readonly<Record<string, unknown>> | null | undefined
                let problemLoaded = false
                let problem: JobProblem | null = null
                const loadProblem = Effect.gen(function* () {
                  yield* assertCurrent
                  if (problemLoaded) {
                    return problem
                  }
                  if (admission !== "Fresh" || stored) {
                    return yield* fail("unavailable")
                  }
                  if (repair) {
                    const [member] = yield* query(
                      `SELECT root_job_id FROM ${t.members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3`,
                      [ref.sandboxId, ref.generation, command.jobId]
                    )
                    root = member ? String(member.root_job_id) : command.jobId
                  } else {
                    root = command.rootJobId
                  }
                  problem = yield* Reconciliation.reconcileLocked(
                    schema,
                    ref.sandboxId,
                    ref.generation,
                    root
                  ).pipe(
                    Effect.provideService(SqlClient, sql),
                    Effect.catchCause((cause) =>
                      Effect.failCause(
                        Cause.map(cause, (error) =>
                          error instanceof PlaygroundError
                            ? error
                            : new CommandTransactionFailure({
                                commitKnowledge: "Unknown"
                              })
                        )
                      )
                    )
                  )
                  problemLoaded = true
                  return problem
                })
                const loadSource = Effect.gen(function* () {
                  yield* loadProblem // sandbox -> problem -> source lock order
                  if (source !== undefined) {
                    return source
                  }
                  const [found] = yield* query(
                    `SELECT j.*,p.format_version,p.payload,p.projection,a.relations,l.accepted,l.invocations
            FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id
            LEFT JOIN ${t.payloads} p ON p.job_id=j.id
            LEFT JOIN ${t.ledger} l ON l.sandbox_id=a.sandbox_id AND l.generation=a.generation AND l.job_id=j.id
            WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
                    [
                      ref.sandboxId,
                      ref.generation,
                      repair ? command.jobId : command.rootJobId
                    ]
                  )
                  source = found ?? null
                  return source
                })
                const materialize = (value: NonNullable<typeof problem>) =>
                  Effect.gen(function* () {
                    if (value.rootJobId !== root) {
                      return yield* fail("unavailable")
                    }
                    const checked = yield* RepairSchema.decodeProblem(value)
                    yield* query(
                      `INSERT INTO ${t.problems}(sandbox_id,generation,root_job_id,problem) VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT(sandbox_id,generation,root_job_id) DO UPDATE SET problem=excluded.problem`,
                      [ref.sandboxId, ref.generation, root, JSON.stringify(checked)]
                    )
                    problem = checked
                  })
                const result = yield* body({
                  admission,
                  stored,
                  assertCurrent,
                  now: query(`SELECT ${clock} AS now`).pipe(
                    Effect.map((rows) => Number(rows[0]!.now))
                  ),
                  source: () => loadSource,
                  problem: () => loadProblem,
                  associate: (resultJobId, next) =>
                    Effect.gen(function* () {
                      yield* assertCurrent
                      const original = yield* loadSource
                      if (
                        !repair ||
                        !original ||
                        resultJobId === command.jobId ||
                        next.activeSuccessorJobId !== resultJobId ||
                        next.state !== "InProgress"
                      ) {
                        return yield* fail("unavailable")
                      }
                      const [child] = yield* query(
                        `SELECT original_source_job_id,source_job_id,redrive_kind FROM ${t.jobs} WHERE id=$1 FOR UPDATE`,
                        [resultJobId]
                      )
                      if (
                        !child ||
                        child.original_source_job_id !== command.jobId ||
                        child.source_job_id !== command.jobId ||
                        child.redrive_kind !==
                          (command.action === "redrive" ? "Redrive" : "CorrectedRedrive")
                      ) {
                        return yield* fail("unavailable")
                      }
                      const maximum =
                        category === "SyntheticSeed" ? 20000 : Mode.retainedMaximum(local)
                      const reserved = yield* query(
                        `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<$2 RETURNING sandbox_id`,
                        [ref.sandboxId, maximum]
                      )
                      if (reserved.length !== 1) {
                        return yield* fail("limit-reached")
                      }
                      yield* query(
                        `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES($1,$2,$3,$4::jsonb)`,
                        [
                          ref.sandboxId,
                          ref.generation,
                          resultJobId,
                          JSON.stringify(original.relations)
                        ]
                      )
                      yield* materialize(next)
                      for (const jobId of [command.jobId, resultJobId]) {
                        yield* query(
                          `INSERT INTO ${t.members}(sandbox_id,generation,job_id,live_job_id,root_job_id) VALUES ($1,$2,$3,$3,$4) ON CONFLICT(sandbox_id,generation,job_id) DO NOTHING`,
                          [ref.sandboxId, ref.generation, jobId, root]
                        )
                      }
                    }),
                  save: (accepted, changes = null) =>
                    Effect.gen(function* () {
                      yield* assertCurrent
                      if (
                        admission !== "Fresh" ||
                        stored ||
                        !sameRef(accepted.sandbox, ref) ||
                        accepted.requestId !== command.requestId
                      ) {
                        return yield* fail("unavailable")
                      }
                      yield* decode(
                        repair ? JobRepairResult : JobResolutionResult,
                        accepted
                      )
                      if (
                        accepted._tag === "Rejected" &&
                        (repair
                          ? !("jobId" in accepted) || accepted.jobId !== command.jobId
                          : !("rootJobId" in accepted) ||
                            accepted.rootJobId !== command.rootJobId)
                      ) {
                        return yield* fail("unavailable")
                      }
                      const value = yield* decode(StoredRepairReceipt, {
                        commandDigest: digest,
                        result: accepted
                      })
                      if (accepted._tag === "Committed") {
                        if (!repair) {
                          if (!("problem" in accepted)) {
                            return yield* fail("unavailable")
                          }
                          if (
                            accepted.problem.rootJobId !== command.rootJobId ||
                            accepted.problem.state !== "Resolved"
                          ) {
                            return yield* fail("unavailable")
                          }
                          yield* loadProblem
                          yield* materialize(accepted.problem)
                          if (source) {
                            yield* query(
                              `INSERT INTO ${t.members}(sandbox_id,generation,job_id,live_job_id,root_job_id) VALUES ($1,$2,$3,$3,$3) ON CONFLICT DO NOTHING`,
                              [ref.sandboxId, ref.generation, root]
                            )
                          }
                        }
                        if (repair) {
                          if (
                            !("resultJobId" in accepted) ||
                            accepted.sourceJobId !== command.jobId ||
                            accepted.action !== command.action
                          ) {
                            return yield* fail("unavailable")
                          }
                          yield* query(
                            `INSERT INTO ${t.edges}(sandbox_id,generation,request_id,root_job_id,original_source_job_id,source_job_id,result_job_id,live_result_job_id,action,observed_at,reason,changes)
                  VALUES ($1,$2,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10::jsonb)`,
                            [
                              ref.sandboxId,
                              ref.generation,
                              command.requestId,
                              root,
                              command.jobId,
                              accepted.resultJobId,
                              command.action,
                              accepted.observedAt,
                              command.reason,
                              JSON.stringify(changes)
                            ]
                          )
                        }
                        const fact =
                          repair && "resultJobId" in accepted
                            ? {
                                _tag: "Operator",
                                requestId: command.requestId,
                                action: command.action,
                                sourceJobId: command.jobId,
                                resultJobId: accepted.resultJobId,
                                observedAt: accepted.observedAt
                              }
                            : {
                                _tag: "Resolution",
                                rootJobId: root,
                                state: "Resolved",
                                kind:
                                  "problem" in accepted
                                    ? accepted.problem.resolution?.kind
                                    : null,
                                reason: command.reason,
                                observedAt: accepted.observedAt
                              }
                        yield* query(
                          `INSERT INTO ${t.audit}(sandbox_id,generation,identity,root_job_id,action,fact,observed_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
                          [
                            ref.sandboxId,
                            ref.generation,
                            command.requestId,
                            root,
                            command.action,
                            JSON.stringify({
                              ...fact,
                              repairReason: repair ? command.reason : null,
                              operatorCategory: category,
                              investigation: repair ? command.investigation : null,
                              changes,
                              validation: repair ? "Valid" : null
                            }),
                            accepted.observedAt
                          ]
                        )
                      }
                      yield* query(
                        `INSERT INTO ${t.receipts}(sandbox_id,generation,operation,request_id,command_digest,receipt) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
                        [...args, digest, JSON.stringify(value)]
                      )
                    })
                })
                if (admission === "Fresh") {
                  yield* assertCurrent
                }
                return result
              })
            )
          )
        }),
      lookup: (access, input, operation) =>
        controls(
          sql.withTransaction(
            Effect.gen(function* () {
              const request = yield* decode(JobRepairReceiptRequest, input)
              yield* lock(access, request.sandbox)
              return yield* lookup(request, operation)
            })
          )
        )
    })
  })
export const make = (schema: string) => makeAdapter(schema, "LocalOperator")
export const layerNoDeps = (schema: string) =>
  Layer.effect(RepairTransactions, make(schema))
export const syntheticLayerNoDeps = (schema: string) =>
  Layer.effect(SyntheticRepairTransactions, makeAdapter(schema, "SyntheticSeed"))
