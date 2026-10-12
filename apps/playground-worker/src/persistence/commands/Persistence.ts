import { Cause, Effect, Layer, Schema } from "effect"
import { EpochMillis } from "effect-jobs/JobPolicy"
import { JobBackendError, JobEnqueue } from "effect-jobs/JobEnqueue"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxAccess } from "@effect-jobs/playground-contracts/Sandbox"
import {
  ReceiptRequest,
  ResetCommand,
  ResetResult,
  ScenarioCommand,
  ScenarioResult
} from "@effect-jobs/playground-contracts/Scenarios"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Plan from "../../scenarios/Plan.js"
import { DocumentKeys } from "../../scenarios/PrivateDocument.js"
import {
  CommandPersistence,
  CommandTransactionFailure,
  CommandTransactions,
  StoredReceipt
} from "./Transactions.js"
import type { CommandTransaction } from "./Transactions.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown,
  code: PlaygroundError["code"] = "invalid-request"
) =>
  Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => fail(code))
  )
// Only a single expected failure can authorize Unknown recovery. All lifecycle
// reasons survive sanitization, including interruption and a fresh bounded Die.
const sanitizeCause = (cause: Cause.Cause<unknown>) =>
  Cause.fromReasons(
    cause.reasons.map((reason): Cause.Reason<PlaygroundError> => {
      if (Cause.isInterruptReason(reason)) {
        return reason
      }
      if (Cause.isDieReason(reason)) {
        return Cause.makeDieReason(new Error("Command persistence defect"))
      }
      return Cause.makeFailReason(
        fail(reason.error instanceof PlaygroundError ? reason.error.code : "unavailable")
      )
    })
  )
const recoverMutation = <A>(
  cause: Cause.Cause<unknown>,
  unknown: A,
  producer = false
) => {
  const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined
  if (
    reason !== undefined &&
    Cause.isFailReason(reason) &&
    (reason.error instanceof CommandTransactionFailure ||
      (producer && reason.error instanceof JobBackendError)) &&
    reason.error.commitKnowledge === "Unknown"
  ) {
    return Effect.succeed(unknown)
  }
  return Effect.failCause(sanitizeCause(cause))
}

const sameRef = (a: SandboxRef, b: SandboxRef) =>
  a.sandboxId === b.sandboxId && a.generation === b.generation

const guard = Effect.fnUntraced(function* (
  access: SandboxAccess,
  expected: SandboxRef,
  tx: CommandTransaction
) {
  const current = yield* decode(SandboxRef, tx.current, "unavailable")
  yield* decode(EpochMillis, tx.dbNow, "unavailable")
  yield* decode(EpochMillis, tx.expiresAt, "unavailable")
  if (
    current.sandboxId !== access.sandbox.ref.sandboxId ||
    expected.sandboxId !== current.sandboxId
  ) {
    return yield* fail("not-found")
  }
  if (tx.expiresAt <= tx.dbNow) {
    return yield* fail("sandbox-expired")
  }
  // Receipt reads for an earlier reset are permitted; the owning write guard is later.
  if (expected.generation > current.generation) {
    return yield* fail("stale-generation")
  }
  return current
})

const validateReceipt = Effect.fnUntraced(function* (
  raw: unknown,
  request: ReceiptRequest,
  operation: "Scenario" | "Reset"
) {
  const receipt = yield* decode(StoredReceipt, raw, "unavailable")
  const ref =
    receipt.result._tag === "Committed" && receipt._tag === "Scenario"
      ? receipt.result.sandbox
      : receipt._tag === "Reset"
        ? receipt.result.previous
        : receipt.command.sandbox
  if (
    receipt._tag !== operation ||
    receipt.result._tag !== "Committed" ||
    receipt.command.requestId !== request.requestId ||
    receipt.result.requestId !== request.requestId ||
    !sameRef(receipt.command.sandbox, request.sandbox) ||
    !sameRef(ref, request.sandbox)
  ) {
    return yield* fail("unavailable")
  }
  if (
    receipt._tag === "Scenario" &&
    receipt.result.jobIds.length !== receipt.command.count
  ) {
    return yield* fail("unavailable")
  }
  return receipt
})

export const make = Effect.gen(function* () {
  const transactions = yield* CommandTransactions
  const producer = yield* JobEnqueue
  const keys = yield* DocumentKeys
  const enqueue = (job: Plan.PlannedJob) =>
    Plan.enqueue(job).pipe(
      Effect.provideService(JobEnqueue, producer),
      Effect.provideService(DocumentKeys, keys)
    )
  const run = Effect.fn("Commands.persistScenario")(function* (
    access: SandboxAccess,
    input: ScenarioCommand
  ) {
    const command = yield* decode(ScenarioCommand, input)
    // Planning has no writes. The seed is fixed server configuration, never client input.
    return yield* transactions
      .owned(access, command, "Scenario", (tx) =>
        Effect.gen(function* () {
          const current = yield* guard(access, command.sandbox, tx)
          const stored = yield* tx.receipt(command, "Scenario")
          if (stored !== null) {
            const receipt = yield* validateReceipt(stored, command, "Scenario")
            if (
              receipt._tag !== "Scenario" ||
              receipt.command.scenario !== command.scenario ||
              receipt.command.count !== command.count
            ) {
              return yield* fail("invalid-request")
            }
            return receipt.result
          }
          if (!sameRef(current, command.sandbox)) {
            return yield* fail("stale-generation")
          }
          if (tx.admission === "Unresolved") {
            return {
              _tag: "OutcomeUnknown" as const,
              sandbox: command.sandbox,
              requestId: command.requestId
            }
          }
          const jobs = yield* Plan.plan(
            command,
            current,
            0,
            command.scenario === "delayed-success" ? tx.dbNow + 120_000 : undefined
          ).pipe(Effect.mapError(() => fail("invalid-request")))
          yield* tx.reserve(jobs.length)
          const jobIds = []
          for (const job of jobs) {
            const produced = yield* enqueue(job)
            if (command.scenario === "deduplication") {
              const duplicate = yield* enqueue(job)
              if (
                duplicate.jobId !== produced.jobId ||
                duplicate._tag !== "AlreadyPresent"
              ) {
                return yield* fail("unavailable")
              }
            }
            yield* tx.associate(produced.jobId, job)
            jobIds.push(produced.jobId)
          }
          const result = yield* decode(
            ScenarioResult.members[0],
            {
              _tag: "Committed",
              sandbox: command.sandbox,
              requestId: command.requestId,
              jobIds
            },
            "unavailable"
          )
          yield* tx.audit({
            operation: "Scenario",
            reason: "synthetic-scenario",
            count: jobs.length
          })
          yield* tx.saveReceipt({ _tag: "Scenario", command, result })
          return result
        })
      )
      .pipe(
        Effect.catchCause((cause) =>
          recoverMutation(
            cause,
            {
              _tag: "OutcomeUnknown" as const,
              sandbox: command.sandbox,
              requestId: command.requestId
            },
            true
          )
        )
      )
  })
  const reset = Effect.fn("Commands.persistReset")(function* (
    access: SandboxAccess,
    input: ResetCommand
  ) {
    const command = yield* decode(ResetCommand, input)
    return yield* transactions
      .owned(access, command, "Reset", (tx) =>
        Effect.gen(function* () {
          const current = yield* guard(access, command.sandbox, tx)
          const stored = yield* tx.receipt(command, "Reset")
          if (stored !== null) {
            const receipt = yield* validateReceipt(stored, command, "Reset")
            if (receipt._tag !== "Reset") {
              return yield* fail("unavailable")
            }
            return receipt.result
          }
          if (!sameRef(current, command.sandbox)) {
            return yield* fail("stale-generation")
          }
          if (tx.admission === "Unresolved") {
            return {
              _tag: "OutcomeUnknown" as const,
              previous: command.sandbox,
              requestId: command.requestId
            }
          }
          if (current.generation === Number.MAX_SAFE_INTEGER) {
            return yield* fail("limit-reached")
          }
          const advanced = yield* tx.advanceGeneration(command.sandbox)
          const result = yield* decode(
            ResetResult,
            {
              _tag: "Committed",
              previous: command.sandbox,
              current: advanced,
              requestId: command.requestId
            },
            "unavailable"
          )
          yield* tx.audit({
            operation: "Reset",
            reason: "generation-revocation",
            count: 0
          })
          yield* tx.saveReceipt({ _tag: "Reset", command, result })
          return result
        })
      )
      .pipe(
        Effect.catchCause((cause) =>
          recoverMutation(cause, {
            _tag: "OutcomeUnknown" as const,
            previous: command.sandbox,
            requestId: command.requestId
          })
        )
      )
  })
  const lookup = (
    operation: "Scenario" | "Reset",
    access: SandboxAccess,
    input: ReceiptRequest
  ) =>
    Effect.gen(function* () {
      const request = yield* decode(ReceiptRequest, input)
      if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
        return yield* fail("not-found")
      }
      if (request.sandbox.generation > access.sandbox.ref.generation) {
        return yield* fail("stale-generation")
      }
      const raw = yield* transactions
        .lookup(access, request, operation)
        .pipe(Effect.catchCause((cause) => Effect.failCause(sanitizeCause(cause))))
      if (raw === null) {
        return null
      }
      return yield* validateReceipt(raw, request, operation)
    })
  return CommandPersistence.of({
    run,
    reset,
    scenarioReceipt: Effect.fn("Commands.scenarioReceipt")(function* (access, request) {
      const receipt = yield* lookup("Scenario", access, request)
      if (receipt === null) {
        return {
          _tag: "OutcomeUnknown",
          sandbox: request.sandbox,
          requestId: request.requestId
        }
      }
      if (receipt._tag !== "Scenario") {
        return yield* fail("unavailable")
      }
      return receipt.result
    }),
    resetReceipt: Effect.fn("Commands.resetReceipt")(function* (access, request) {
      const receipt = yield* lookup("Reset", access, request)
      if (receipt === null) {
        return {
          _tag: "OutcomeUnknown",
          previous: request.sandbox,
          requestId: request.requestId
        }
      }
      if (receipt._tag !== "Reset") {
        return yield* fail("unavailable")
      }
      return receipt.result
    })
  })
})

// No default CommandTransactions/JobEnqueue/key Layer is installed here.
export const layerNoDeps = Layer.effect(CommandPersistence, make)
