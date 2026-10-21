import { Cause, Effect, Layer, Schema } from "effect"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlFailure } from "effect-jobs/PostgreSqlTransaction"
import {
  Operators,
  JobOperatorCommand,
  JobOperatorReceiptRequest,
  JobOperatorResult,
  commandIdentity,
  matchesCommandResult
} from "@effect-jobs/playground-contracts/Operators"
import type { JobOperatorReason } from "@effect-jobs/playground-contracts/Operators"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { OperatorTransactions } from "./OperatorTransactions.js"
import { CommandTransactionFailure } from "./Transactions.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown
) =>
  Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => fail("invalid-request"))
  )
const unknown = (request: JobOperatorReceiptRequest): JobOperatorResult => ({
  _tag: "OutcomeUnknown",
  sandbox: request.sandbox,
  requestId: request.requestId
})
// Only a single classified storage uncertainty authorizes an Unknown result.
// Mixed failures/interruption survive sanitization and cannot grant replay.
const recover = (request: JobOperatorReceiptRequest) => (cause: Cause.Cause<unknown>) => {
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
          return Cause.makeDieReason(new Error("Operator persistence defect"))
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
export const make = Effect.gen(function* () {
  const transactions = yield* OperatorTransactions
  const backend = yield* PostgreSqlJobs
  return Operators.of({
    execute: Effect.fn("Operators.execute")(function* (access, input) {
      const command = yield* decode(JobOperatorCommand, input)
      const reject = (reason: JobOperatorReason) => ({
        _tag: "Rejected" as const,
        sandbox: command.sandbox,
        requestId: command.requestId,
        action: command.action,
        jobId: command.jobId,
        reason
      })
      const result = yield* transactions
        .owned(access, command, (tx) =>
          Effect.gen(function* () {
            if (tx.stored) {
              if (
                commandIdentity(tx.stored.command) !== commandIdentity(command) ||
                !matchesCommandResult(command, tx.stored.result)
              ) {
                return yield* fail("unavailable")
              }
              return tx.stored.result
            }
            if (tx.admission === "Unresolved") {
              return unknown(command)
            }
            yield* tx.assertCurrent
            const source = yield* tx.source()
            if (source === null) {
              const result = reject("not-found")
              yield* tx.save(result)
              return result
            }
            const expected = {
              jobId: command.jobId,
              state: command.expectedState,
              lifecycleVersion: command.expectedLifecycleVersion
            }
            const operate = Effect.gen(function* () {
              if (command.action === "redrive") {
                return reject("investigation-required")
              }
              const transition = yield* command.action === "cancel"
                ? backend.operators.cancel(expected)
                : backend.operators.retryNow(expected)
              return yield* decode(JobOperatorResult.members[0], {
                _tag: "Committed",
                sandbox: command.sandbox,
                requestId: command.requestId,
                action: command.action,
                sourceJobId: command.jobId,
                sourceState: transition.beforeState,
                sourceLifecycleVersion: transition.beforeVersion,
                resultJobId: transition.jobId,
                resultState: transition.after.state,
                resultLifecycleVersion: transition.after.lifecycleVersion,
                observedAt: transition.after.updatedAt
              })
            }).pipe(
              Effect.catchTags({
                JobOperatorRejected: (error) =>
                  error.reason === "lineage-conflict"
                    ? Effect.fail(error)
                    : Effect.succeed(reject(error.reason))
              })
            )
            const result = yield* operate
            yield* tx.save(result)
            return result
          })
        )
        .pipe(Effect.catchCause(recover(command)))
      if (!matchesCommandResult(command, result)) {
        return yield* fail("unavailable")
      }
      return result
    }),
    receipt: Effect.fn("Operators.receipt")(function* (access, input) {
      const request = yield* decode(JobOperatorReceiptRequest, input)
      const stored = yield* transactions
        .lookup(access, request)
        .pipe(Effect.catchCause(recover(request)))
      if (stored === null) {
        return unknown(request)
      }
      if ("_tag" in stored) {
        return stored
      }
      if (
        !matchesCommandResult(stored.command, stored.result) ||
        stored.result.requestId !== request.requestId ||
        stored.result.sandbox.sandboxId !== request.sandbox.sandboxId ||
        stored.result.sandbox.generation !== request.sandbox.generation
      ) {
        return yield* fail("unavailable")
      }
      return stored.result
    })
  })
})
export const layerNoDeps = Layer.effect(Operators, make)
