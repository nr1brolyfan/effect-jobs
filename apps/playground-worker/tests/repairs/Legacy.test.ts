import { runPromise } from "../scenarios/Setup.js"
import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { JobOperators } from "effect-jobs/JobOperators"
import type { JobOperatorsService } from "effect-jobs/JobOperators"
import { JobPersistenceError } from "effect-jobs/JobEnqueue"
import {
  JobOperatorCommand,
  type JobOperatorResult
} from "@effect-jobs/playground-contracts/Operators"
import * as Legacy from "../../src/persistence/commands/OperatorPersistence.js"
import {
  OperatorTransactions,
  StoredOperatorReceipt,
  type OperatorTransaction
} from "../../src/persistence/commands/OperatorTransactions.js"
import * as Fixture from "./Fixtures.js"

const command = Schema.decodeUnknownSync(JobOperatorCommand)({
  sandbox: Fixture.ref,
  requestId: "legacy-redrive",
  jobId: Fixture.sourceId,
  expectedState: "Dead",
  expectedLifecycleVersion: 2,
  action: "redrive",
  confirmDuplicateEffects: true
})
const access = {
  sandbox: {
    ref: Fixture.ref,
    expiresAt: 100000,
    capabilities: {
      runScenario: true,
      resetSandbox: true,
      retryJob: true,
      cancelJob: true,
      redriveJob: true
    }
  }
}
const unexpected = () => Effect.die("Legacy redrive must not invoke core")
const make = (
  stored: StoredOperatorReceipt | null = null,
  cancel: JobOperatorsService<JobPersistenceError>["cancel"] = unexpected
) =>
  Effect.gen(function* () {
    const saved: JobOperatorResult[] = []
    const tx: OperatorTransaction = {
      admission: stored ? "Unresolved" : "Fresh",
      stored,
      source: () =>
        stored
          ? Effect.die("Historical receipt needs no source")
          : Effect.succeed(Fixture.sourceRow),
      assertCurrent: Effect.void,
      associateRedrive: unexpected,
      save: (result) =>
        Effect.sync(() => {
          saved.push(result)
        })
    }
    const transactions = Layer.mock(OperatorTransactions, {
      owned: (_access, _command, body) => body(tx),
      lookup: () => Effect.succeed(stored)
    })
    const operators = Layer.succeed(JobOperators, {
      retryNow: unexpected,
      cancel,
      redrive: unexpected,
      correctedRedrive: unexpected
    })
    const service = yield* Legacy.make.pipe(
      Effect.provide(Layer.merge(operators, transactions))
    )
    return { service, saved }
  })

describe("legacy operator redrive admission", () => {
  it("refuses a new bypass before core/artifact execution", async () => {
    await runPromise(
      Effect.gen(function* () {
        const app = yield* make()
        const result = yield* app.service.execute(access, command)
        expect(result).toMatchObject({
          _tag: "Rejected",
          reason: "investigation-required"
        })
        expect(app.saved).toEqual([result])
      })
    )
  })
  it("keeps exact historical acceptance readable without replay or a retained source", async () => {
    const stored = Schema.decodeUnknownSync(StoredOperatorReceipt)({
      command,
      result: {
        _tag: "Committed",
        sandbox: Fixture.ref,
        requestId: command.requestId,
        action: "redrive",
        sourceJobId: Fixture.sourceId,
        sourceState: "Dead",
        sourceLifecycleVersion: 2,
        resultJobId: Fixture.successorId,
        resultState: "Pending",
        resultLifecycleVersion: 0,
        observedAt: 1000
      }
    })
    await runPromise(
      Effect.gen(function* () {
        const app = yield* make(stored)
        expect(yield* app.service.execute(access, command)).toEqual(stored.result)
        expect(
          yield* app.service.receipt(access, {
            sandbox: Fixture.ref,
            requestId: command.requestId
          })
        ).toEqual(stored.result)
        expect(app.saved).toEqual([])
      })
    )
  })
})

it("reconciles a single portable Unknown and preserves a mixed failure with interruption", async () => {
  const cancel = Schema.decodeUnknownSync(JobOperatorCommand)({
    sandbox: Fixture.ref,
    requestId: "cancel",
    jobId: Fixture.sourceId,
    expectedState: "Pending",
    expectedLifecycleVersion: 2,
    action: "cancel"
  })
  const unknown = new JobPersistenceError({
    reason: "storage-failure",
    commitKnowledge: "Unknown"
  })
  await runPromise(
    Effect.gen(function* () {
      const app = yield* make(null, () => Effect.fail(unknown))
      expect(yield* app.service.execute(access, cancel)).toMatchObject({
        _tag: "OutcomeUnknown",
        requestId: cancel.requestId
      })
      expect(app.saved).toEqual([])

      const mixed = Cause.fromReasons([
        Cause.makeFailReason(unknown),
        Cause.makeInterruptReason(42)
      ])
      const interrupted = yield* make(null, () => Effect.failCause(mixed))
      const exit = yield* Effect.exit(interrupted.service.execute(access, cancel))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(2)
        expect(Cause.hasInterrupts(exit.cause)).toBe(true)
        expect(Cause.hasFails(exit.cause)).toBe(true)
      }
      expect(interrupted.saved).toEqual([])
    })
  )
})
