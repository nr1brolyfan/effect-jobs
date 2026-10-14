import { Cause, Context, Effect, Layer, Schema } from "effect"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlFailure } from "effect-jobs/PostgreSqlTransaction"
import {
  Repairs,
  JobRepairCommand,
  JobResolutionCommand,
  JobRepairReceiptRequest,
  JobRepairResult,
  JobResolutionResult
} from "@effect-jobs/playground-contracts/Repairs"
import type {
  JobProblem,
  JobRepairReason
} from "@effect-jobs/playground-contracts/Repairs"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import {
  RepairTransactions,
  SyntheticRepairTransactions,
  type RepairCommand,
  type RepairResult
} from "./RepairTransactions.js"
import { CommandTransactionFailure } from "./Transactions.js"
import * as Source from "./RepairSource.js"
import * as OperatorSource from "./OperatorSource.js"
import * as Definitions from "../../scenarios/Definitions.js"
import { DocumentKeys } from "../../scenarios/PrivateDocument.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown
) =>
  Effect.try({
    try: () => JSON.parse(Source.canonicalJson(input, 131072)) as unknown,
    catch: () => fail("invalid-request")
  }).pipe(
    Effect.flatMap((snapshot) =>
      Schema.decodeUnknownEffect(schema)(snapshot, { onExcessProperty: "error" })
    ),
    Effect.mapError(() => fail("invalid-request"))
  )
const unknown = (request: JobRepairReceiptRequest) => ({
  _tag: "OutcomeUnknown" as const,
  sandbox: request.sandbox,
  requestId: request.requestId
})
export const recover =
  (request: JobRepairReceiptRequest) => (cause: Cause.Cause<unknown>) => {
    const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined
    if (
      reason &&
      Cause.isFailReason(reason) &&
      (reason.error instanceof CommandTransactionFailure ||
        reason.error instanceof PostgreSqlFailure) &&
      reason.error.commitKnowledge === "Unknown"
    ) {
      return Effect.succeed(unknown(request))
    }
    return Effect.failCause(
      Cause.fromReasons(
        cause.reasons.map((reason): Cause.Reason<PlaygroundError> => {
          if (Cause.isInterruptReason(reason)) {
            return reason
          }
          if (Cause.isDieReason(reason)) {
            return Cause.makeDieReason(new Error("Repair persistence defect"))
          }
          return Cause.makeFailReason(
            reason.error instanceof PlaygroundError
              ? fail(reason.error.code)
              : fail("unavailable")
          )
        })
      )
    )
  }
export const implicitProblem = (
  rootJobId: JobProblem["rootJobId"],
  updatedAt: number,
  outcomeKnowledge: JobProblem["outcomeKnowledge"] = "Unknown"
): JobProblem => ({
  rootJobId,
  state: "Open",
  version: 0,
  updatedAt,
  activeSuccessorJobId: null,
  outcomeKnowledge,
  resolution: null
})
export const refuseProblem = (
  problem: JobProblem,
  command: JobRepairCommand
): JobRepairReason | null => {
  if (problem.version !== command.expectedResolutionVersion) {
    return "resolution-conflict"
  }
  if (problem.state === "Resolved") {
    return "already-resolved"
  }
  if (problem.state === "InProgress") {
    return "repair-in-progress"
  }
  if ((problem.activeSuccessorJobId ?? problem.rootJobId) !== command.jobId) {
    return "resolution-conflict"
  }
  return null
}

const makeService = (transactions: typeof RepairTransactions.Service) =>
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs
    const keys = yield* DocumentKeys
    const run = (
      access: Parameters<typeof transactions.owned>[0],
      command: RepairCommand
    ): Effect.Effect<RepairResult, PlaygroundError> =>
      Effect.gen(function* () {
        const digest = yield* Source.commandDigest(command).pipe(
          Effect.mapError(() => fail("invalid-request"))
        )
        const repair = "jobId" in command
        const reject = (reason: JobRepairReason): RepairResult =>
          repair
            ? {
                _tag: "Rejected",
                sandbox: command.sandbox,
                requestId: command.requestId,
                jobId: command.jobId,
                reason
              }
            : {
                _tag: "Rejected",
                sandbox: command.sandbox,
                requestId: command.requestId,
                rootJobId: command.rootJobId,
                reason
              }
        return yield* transactions
          .owned(access, command, digest, (tx) =>
            Effect.gen(function* () {
              if (tx.admission === "Conflict") {
                return reject("request-conflict")
              }
              if (tx.stored) {
                return tx.stored.result
              }
              if (tx.admission !== "Fresh") {
                return unknown(command)
              }
              yield* tx.assertCurrent
              const stored = yield* tx.problem()
              const source = yield* tx.source()
              const operate = Effect.gen(function* () {
                if (
                  !stored &&
                  (!source || !["Dead", "Isolated"].includes(String(source.state)))
                ) {
                  return reject("not-found")
                }
                const problem =
                  stored ??
                  implicitProblem(
                    repair ? command.jobId : command.rootJobId,
                    Number(source!.updated_at),
                    Source.knownFailure(source!) ? "KnownFailure" : "Unknown"
                  )
                if (problem.version !== command.expectedResolutionVersion) {
                  return reject("resolution-conflict")
                }
                if (problem.version === Number.MAX_SAFE_INTEGER) {
                  return reject("arithmetic-bound")
                }
                if (problem.state === "Resolved") {
                  return reject("already-resolved")
                }
                if (!repair) {
                  if (
                    command.action === "manual-close" &&
                    problem.outcomeKnowledge === "Unknown" &&
                    command.confirmUnknownOutcome !== true
                  ) {
                    return reject("investigation-required")
                  }
                  const observedAt = yield* tx.now
                  return {
                    _tag: "Committed" as const,
                    sandbox: command.sandbox,
                    requestId: command.requestId,
                    observedAt,
                    problem: {
                      ...problem,
                      state: "Resolved" as const,
                      version: problem.version + 1,
                      updatedAt: observedAt,
                      resolution: {
                        kind:
                          command.action === "manual-close"
                            ? ("ManualClose" as const)
                            : ("OperatorReconciled" as const),
                        reason: command.reason,
                        observedAt,
                        successorJobId: problem.activeSuccessorJobId
                      }
                    }
                  }
                }
                const refusal = refuseProblem(problem, command)
                if (refusal) {
                  return reject(refusal)
                }
                if (!source) {
                  return reject("not-found")
                }
                if (
                  source.state !== command.expectedState ||
                  Number(source.lifecycle_version) !== command.expectedLifecycleVersion
                ) {
                  return reject("state-version-conflict")
                }
                const knowledge = yield* Source.investigate(source, command)
                const expected = {
                  jobId: command.jobId,
                  state: command.expectedState,
                  lifecycleVersion: command.expectedLifecycleVersion
                }
                const producer = yield* Source.producerIdentity(command)
                let changes: ReadonlyArray<{ kind: string; path: string }> | null = null
                const produced = yield* Effect.gen(function* () {
                  if (command.action === "corrected-redrive") {
                    const prepared = yield* Source.replacement(
                      source,
                      command.sandbox,
                      command.payload
                    )
                    changes = prepared.changes
                    yield* tx.assertCurrent
                    if (prepared._tag === "Synthetic") {
                      return yield* backend.operators.correctedRedrive(
                        Definitions.SyntheticDocumentExport,
                        { expected, producer, payload: prepared.payload }
                      )
                    }
                    return yield* backend.operators.correctedRedrive(
                      {
                        catalog: prepared.definition.catalog,
                        payload: Definitions.Payload
                      },
                      { expected, producer, payload: prepared.payload }
                    )
                  }
                  const definition = yield* OperatorSource.validate(
                    source,
                    command.sandbox
                  ).pipe(Effect.provideService(DocumentKeys, keys))
                  yield* tx.assertCurrent
                  return yield* backend.operators
                    .redrive<
                      typeof Definitions.Payload | typeof Definitions.ExportPayload
                    >(definition, { expected, producer })
                    .pipe(Effect.provideService(DocumentKeys, keys))
                })
                // Fresh immutable admission cannot have prior app acceptance. A matching
                // core tuple alone does not prove association/receipt ownership.
                if (!produced.inserted) {
                  return yield* fail("unavailable")
                }
                const next: JobProblem = {
                  ...problem,
                  state: "InProgress",
                  version: problem.version + 1,
                  updatedAt: produced.dbNow,
                  activeSuccessorJobId: produced.jobId,
                  outcomeKnowledge:
                    problem.outcomeKnowledge === "Unknown" && problem.version > 0
                      ? "Unknown"
                      : knowledge,
                  resolution: null
                }
                yield* tx.associate(produced.jobId, next)
                const result = yield* decode(JobRepairResult.members[0], {
                  _tag: "Committed",
                  sandbox: command.sandbox,
                  requestId: command.requestId,
                  action: command.action,
                  sourceJobId: command.jobId,
                  sourceState: command.expectedState,
                  sourceLifecycleVersion: command.expectedLifecycleVersion,
                  resultJobId: produced.jobId,
                  observedAt: produced.dbNow,
                  problem: next
                })
                yield* tx.save(result, changes)
                return result
              }).pipe(
                Effect.catchTag("RepairSourceRejected", (error) =>
                  Effect.succeed(reject(error.reason))
                ),
                Effect.catchTag("OperatorSourceRejected", (error) =>
                  Effect.succeed(reject(error.reason))
                ),
                Effect.catchTag("JobPayloadCodecError", () =>
                  Effect.succeed(reject("invalid-payload"))
                ),
                // lineage-conflict poisons the transaction and MUST NOT be saved as a
                // safe refusal after a partial core insert.
                Effect.catchTag("JobOperatorRejected", (error) =>
                  String(error.reason) === "lineage-conflict"
                    ? Effect.fail(error)
                    : Effect.succeed(reject(error.reason))
                )
              )
              const result = yield* operate
              if (
                result._tag !== "OutcomeUnknown" &&
                (!repair || result._tag === "Rejected")
              ) {
                yield* tx.save(result)
              }
              return result
            })
          )
          .pipe(Effect.catchCause(recover(command)))
      })
    return Repairs.of({
      execute: (access, input) =>
        decode(JobRepairCommand, input).pipe(
          Effect.flatMap((command) => run(access, command)),
          Effect.flatMap((result) => decode(JobRepairResult, result))
        ),
      resolve: (access, input) =>
        decode(JobResolutionCommand, input).pipe(
          Effect.flatMap((command) => run(access, command)),
          Effect.flatMap((result) => decode(JobResolutionResult, result))
        ),
      receipt: (access, input) =>
        decode(JobRepairReceiptRequest, input).pipe(
          Effect.flatMap((request) =>
            transactions.lookup(access, request, "Repair").pipe(
              Effect.map((stored) => stored?.result ?? unknown(request)),
              Effect.catchCause(recover(request))
            )
          ),
          Effect.flatMap((result) => decode(JobRepairResult, result))
        ),
      resolutionReceipt: (access, input) =>
        decode(JobRepairReceiptRequest, input).pipe(
          Effect.flatMap((request) =>
            transactions.lookup(access, request, "Resolution").pipe(
              Effect.map((stored) => stored?.result ?? unknown(request)),
              Effect.catchCause(recover(request))
            )
          ),
          Effect.flatMap((result) => decode(JobResolutionResult, result))
        )
    })
  })
export const make = Effect.gen(function* () {
  return yield* makeService(yield* RepairTransactions)
})
export const layerNoDeps = Layer.effect(Repairs, make)
export class SyntheticRepairs extends Context.Service<
  SyntheticRepairs,
  typeof Repairs.Service
>()("playground/SyntheticRepairs") {}
export const syntheticLayerNoDeps = Layer.effect(
  SyntheticRepairs,
  Effect.gen(function* () {
    return yield* makeService(yield* SyntheticRepairTransactions)
  })
)
