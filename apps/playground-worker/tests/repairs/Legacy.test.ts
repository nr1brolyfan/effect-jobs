import { describe, expect, it } from "vitest"
import { Effect, Layer, Schema } from "effect"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import * as Tables from "effect-jobs/PostgreSqlSchema"
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
const backend = Layer.mock(PostgreSqlJobs, {
  tables: Tables.tables(),
  producer: { enqueue: unexpected, enqueueStandalone: unexpected },
  store: {
    claim: unexpected,
    reconcileClaim: unexpected,
    release: unexpected,
    finalize: unexpected,
    reconcileFinalization: unexpected,
    recoverExpired: unexpected
  },
  cleanup: { cleanup: unexpected },
  operators: {
    retryNow: unexpected,
    cancel: unexpected,
    redrive: unexpected,
    correctedRedrive: unexpected
  }
})
const make = (stored: StoredOperatorReceipt | null = null) =>
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
    const service = yield* Legacy.make.pipe(
      Effect.provide(Layer.merge(backend, transactions))
    )
    return { service, saved }
  })

describe("legacy operator redrive admission", () => {
  it("refuses a new bypass before core/artifact execution", async () => {
    await Effect.runPromise(
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
    await Effect.runPromise(
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
