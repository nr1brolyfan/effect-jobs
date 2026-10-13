import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import {
  JobRepairCommand,
  JobResolutionCommand
} from "@effect-jobs/playground-contracts/Repairs"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"

const problem = {
  rootJobId: Fixtures.detail.job.jobId,
  state: "Open",
  version: 0,
  updatedAt: Fixtures.detail.job.updatedAt,
  activeSuccessorJobId: null,
  outcomeKnowledge: "Unknown",
  resolution: null
}
const detail = Schema.decodeUnknownSync(JobDetail)({
  ...Fixtures.detail,
  job: { ...Fixtures.detail.job, state: "Dead" },
  problem,
  eligibility: {
    redrive: { enabled: true, reason: null },
    correctedRedrive: { enabled: true, reason: null }
  }
})
const run = <A>(effect: Effect.Effect<A, never, JobsClient>, client: Client) =>
  Effect.runPromise(effect.pipe(Effect.provideService(JobsClient, client)))
describe("registry-owned immutable repair uncertainty", () => {
  it("retains definitive repair identity and payload through navigation and permits only exact receipt reads", async () => {
    const state = Atoms.make({ ...Fixtures.sandbox, expiresAt: Date.now() + 60000 })
    const sent: (typeof JobRepairCommand.Type)[] = [],
      receipts: string[] = []
    const client: Client = {
      ...FixtureClient.client,
      detail: () => Effect.succeed(detail),
      repair: (command) =>
        Effect.sync(() => {
          sent.push(command)
          return {
            _tag: "OutcomeUnknown" as const,
            sandbox: command.sandbox,
            requestId: command.requestId
          }
        }),
      repairReceipt: (request) =>
        Effect.sync(() => {
          receipts.push(request.requestId)
          return { _tag: "OutcomeUnknown" as const, ...request }
        })
    }
    try {
      await run(state.select(detail.job.jobId), client)
      const input = Schema.decodeUnknownSync(JobRepairCommand)({
        sandbox: detail.sandbox,
        requestId: "panel-placeholder",
        jobId: detail.job.jobId,
        expectedState: "Dead",
        expectedLifecycleVersion: detail.job.lifecycleVersion,
        expectedResolutionVersion: 0,
        action: "corrected-redrive",
        reason: "Synthetic correction",
        confirmDuplicateEffects: true,
        investigation: { _tag: "AcceptDuplicateRisk", reason: "Synthetic investigation" },
        payload: { behavior: "success" }
      })
      await run(state.repair(input), client)
      expect(sent).toHaveLength(1)
      expect(sent[0]!.requestId).not.toBe(input.requestId)
      expect(Object.isFrozen(sent[0])).toBe(true)
      expect(Object.isFrozen(sent[0]!.sandbox)).toBe(true)
      expect(
        sent[0]!.action === "corrected-redrive" && Object.isFrozen(sent[0]!.payload)
      ).toBe(true)
      state.closeDetail()
      await run(state.select(detail.job.jobId), client)
      await run(state.repair({ ...input, requestId: "new-unsafe-identity" }), client)
      await run(state.receipt, client)
      expect(sent).toHaveLength(1)
      expect(receipts).toEqual([sent[0]!.requestId])
      expect(state.snapshot().pending?.request.requestId).toBe(sent[0]!.requestId)
    } finally {
      state.dispose()
    }
  })
  it("keeps resolution uncertainty distinct from a repair receipt", async () => {
    const state = Atoms.make({ ...Fixtures.sandbox, expiresAt: Date.now() + 60000 })
    let resolutionReads = 0,
      repairReads = 0
    const client: Client = {
      ...FixtureClient.client,
      detail: () => Effect.succeed(detail),
      resolve: (command) =>
        Effect.succeed({
          _tag: "OutcomeUnknown",
          sandbox: command.sandbox,
          requestId: command.requestId
        }),
      resolutionReceipt: (request) =>
        Effect.sync(() => {
          resolutionReads++
          return { _tag: "OutcomeUnknown" as const, ...request }
        }),
      repairReceipt: () =>
        Effect.sync(() => {
          repairReads++
          throw new Error("wrong receipt port")
        })
    }
    try {
      await run(state.select(detail.job.jobId), client)
      const command = Schema.decodeUnknownSync(JobResolutionCommand)({
        sandbox: detail.sandbox,
        requestId: "panel-resolution",
        rootJobId: detail.job.jobId,
        expectedResolutionVersion: 0,
        action: "manual-close",
        reason: "Synthetic manual closure",
        confirmUnknownOutcome: true
      })
      await run(state.repair(command), client)
      expect(state.snapshot().pending?.kind).toBe("resolution")
      await run(state.receipt, client)
      expect(resolutionReads).toBe(1)
      expect(repairReads).toBe(0)
    } finally {
      state.dispose()
    }
  })
})
