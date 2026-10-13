import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"
import { JobRedriveResult } from "effect-jobs/JobOperators"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { JobResolutionCommand } from "@effect-jobs/playground-contracts/Repairs"
import {
  RepairTransactions,
  type RepairTransaction,
  type RepairResult
} from "../../src/persistence/commands/RepairTransactions.js"
import { CommandTransactionFailure } from "../../src/persistence/commands/Transactions.js"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Persistence from "../../src/persistence/commands/RepairPersistence.js"
import * as Definitions from "../../src/scenarios/Definitions.js"
import { keysLayer } from "../../src/scenarios/PrivateDocument.js"
import * as Fixture from "./Fixtures.js"

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
const setup = (override: Partial<RepairTransaction> = {}) =>
  Effect.gen(function* () {
    let coreCalls = 0,
      associations = 0
    const saved: RepairResult[] = []
    const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, Fixture.payload)
    const produced = Schema.decodeUnknownSync(JobRedriveResult)({
      source: { jobId: Fixture.sourceId, state: "Dead", lifecycleVersion: 2 },
      jobId: Fixture.successorId,
      inserted: true,
      dbNow: 1000,
      lineage: {
        originalSourceJobId: Fixture.sourceId,
        sourceJobId: Fixture.sourceId,
        kind: "CorrectedRedrive"
      }
    })
    const tx: RepairTransaction = {
      admission: "Fresh",
      stored: null,
      assertCurrent: Effect.void,
      now: Effect.succeed(1000),
      source: () =>
        Effect.succeed({
          ...Fixture.sourceRow,
          format_version: 1,
          payload: encoded.payloadBytes,
          projection: encoded.semanticProjectionBytes
        }),
      problem: () => Effect.succeed(null),
      associate: () =>
        Effect.sync(() => {
          associations++
        }),
      save: (value) =>
        Effect.sync(() => {
          saved.push(value)
        }),
      ...override
    }
    const transactions = Layer.mock(RepairTransactions, {
      owned: (_access, _command, _digest, body) => body(tx),
      lookup: () => Effect.succeed(null)
    })
    const unexpected = () => Effect.die("Unexpected backend operation")
    const core = Layer.mock(PostgreSqlJobs, {
      tables: PostgreSqlSchema.tables(),
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
        correctedRedrive: () =>
          Effect.sync(() => {
            coreCalls++
            return produced
          }),
        redrive: () =>
          Effect.sync(() => {
            coreCalls++
            return produced
          }),
        retryNow: () => Effect.die("Unexpected retry"),
        cancel: () => Effect.die("Unexpected cancel")
      }
    })
    const service = yield* Persistence.make.pipe(
      Effect.provide(Layer.mergeAll(transactions, core, keysLayer))
    )
    return {
      service,
      saved,
      coreCalls: () => coreCalls,
      associations: () => associations
    }
  })

describe("repair command protocol with isolated core/transaction ports", () => {
  it("commits a validated fresh repair through core, association and exact receipt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* setup()
        const result = yield* app.service.execute(access, Fixture.command)
        expect(result).toMatchObject({
          _tag: "Committed",
          sourceJobId: Fixture.sourceId,
          resultJobId: Fixture.successorId,
          problem: {
            state: "InProgress",
            rootJobId: Fixture.sourceId,
            outcomeKnowledge: "KnownFailure"
          }
        })
        expect(app.coreCalls()).toBe(1)
        expect(app.associations()).toBe(1)
        expect(app.saved).toEqual([result])
      })
    )
  })
  it("missing exact receipt and unresolved admission never authorize replay", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* setup({ admission: "Unresolved" })
        expect((yield* app.service.execute(access, Fixture.command))._tag).toBe(
          "OutcomeUnknown"
        )
        expect(
          (yield* app.service.receipt(access, {
            sandbox: Fixture.ref,
            requestId: Fixture.command.requestId
          }))._tag
        ).toBe("OutcomeUnknown")
        expect(app.coreCalls()).toBe(0)
        expect(app.associations()).toBe(0)
        expect(app.saved).toEqual([])
      })
    )
  })
  it("conflicting admission returns a refusal without overwriting anything", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* setup({ admission: "Conflict" })
        expect(yield* app.service.execute(access, Fixture.command)).toMatchObject({
          _tag: "Rejected",
          reason: "request-conflict"
        })
        expect(app.coreCalls()).toBe(0)
        expect(app.saved).toEqual([])
      })
    )
  })
  it("exact historical receipt is returned without source/core/receipt writes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const result = {
          _tag: "Rejected" as const,
          sandbox: Fixture.ref,
          requestId: Fixture.command.requestId,
          jobId: Fixture.sourceId,
          reason: "not-eligible" as const
        }
        const app = yield* setup({
          admission: "Unresolved",
          stored: { commandDigest: "a".repeat(64), result },
          source: () => Effect.die("Must not read source"),
          problem: () => Effect.die("Must not read problem")
        })
        expect(yield* app.service.execute(access, Fixture.command)).toEqual(result)
        expect(app.coreCalls()).toBe(0)
        expect(app.saved).toEqual([])
      })
    )
  })
  it("expired authority and failed association abort instead of persisting an acceptance", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const expired = yield* setup({
          assertCurrent: Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
        })
        expect(
          Exit.isFailure(
            yield* Effect.exit(expired.service.execute(access, Fixture.command))
          )
        ).toBe(true)
        expect(expired.coreCalls()).toBe(0)
        const broken = yield* setup({
          associate: () =>
            Effect.fail(new CommandTransactionFailure({ commitKnowledge: "Unknown" }))
        })
        expect((yield* broken.service.execute(access, Fixture.command))._tag).toBe(
          "OutcomeUnknown"
        )
        expect(broken.saved).toEqual([])
      })
    )
  })
  it("requires explicit unknown confirmation for manual close and audits resolution without invoking core", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* setup({
          problem: () =>
            Effect.succeed({
              ...Fixture.problem,
              state: "Open",
              outcomeKnowledge: "Unknown"
            })
        })
        const input = Schema.decodeUnknownSync(JobResolutionCommand)({
          sandbox: Fixture.ref,
          requestId: "resolve-request",
          rootJobId: Fixture.sourceId,
          expectedResolutionVersion: 1,
          reason: "Investigation complete",
          action: "manual-close"
        })
        expect(yield* app.service.resolve(access, input)).toMatchObject({
          _tag: "Rejected",
          reason: "investigation-required"
        })
        expect(
          yield* app.service.resolve(access, { ...input, confirmUnknownOutcome: true })
        ).toMatchObject({
          _tag: "Committed",
          problem: {
            state: "Resolved",
            outcomeKnowledge: "Unknown",
            resolution: { kind: "ManualClose", reason: "Investigation complete" }
          }
        })
        expect(app.coreCalls()).toBe(0)
        expect(app.associations()).toBe(0)
      })
    )
  })
  it("sanitizes but preserves mixed failure/defect/interrupt causes", async () => {
    const unknown = new CommandTransactionFailure({ commitKnowledge: "Unknown" })
    expect(
      await Effect.runPromise(Persistence.recover(Fixture.command)(Cause.fail(unknown)))
    ).toMatchObject({ _tag: "OutcomeUnknown" })
    const mixed = Cause.fromReasons([
      Cause.makeFailReason(unknown),
      Cause.makeDieReason(new Error("private-provider-text"))
    ])
    const result = await Effect.runPromise(
      Effect.exit(Persistence.recover(Fixture.command)(mixed))
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons).toHaveLength(2)
      expect(Cause.hasDies(result.cause)).toBe(true)
      expect(JSON.stringify(result.cause)).not.toContain("private-provider-text")
    }
  })
})
