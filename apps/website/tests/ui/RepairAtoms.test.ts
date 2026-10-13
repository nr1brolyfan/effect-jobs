import { describe, expect, it } from "vitest"
import { Deferred, Effect, Fiber, Schema } from "effect"
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

describe("definitive repair acknowledgement read ownership", () => {
  for (const kind of ["repair", "resolution"] as const) {
    for (const outcome of ["Committed", "Rejected"] as const) {
      for (const receipt of [false, true]) {
        it(`${kind} ${outcome} via ${receipt ? "exact receipt" : "command"} releases foreground loading and fences old rows`, async () => {
          const sandbox = { ...Fixtures.sandbox, expiresAt: Date.now() + 60000 }
          const state = Atoms.make(sandbox)
          let writes = 0
          try {
            await Effect.runPromise(
              Effect.gen(function* () {
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                let listCalls = 0
                let sent: JobRepairCommand | JobResolutionCommand | undefined
                const definitive = () => {
                  if (!sent) {
                    throw new Error("no original request")
                  }
                  const common = { sandbox: sent.sandbox, requestId: sent.requestId }
                  if (outcome === "Rejected") {
                    return kind === "repair"
                      ? {
                          ...common,
                          _tag: "Rejected" as const,
                          jobId: detail.job.jobId,
                          reason: "resolution-conflict" as const
                        }
                      : {
                          ...common,
                          _tag: "Rejected" as const,
                          rootJobId: detail.job.jobId,
                          reason: "resolution-conflict" as const
                        }
                  }
                  const acknowledgedProblem = {
                    ...detail.problem!,
                    state: "InProgress" as const,
                    version: 1
                  }
                  return kind === "repair"
                    ? {
                        ...common,
                        _tag: "Committed" as const,
                        action: "redrive" as const,
                        sourceJobId: detail.job.jobId,
                        sourceState: "Dead" as const,
                        sourceLifecycleVersion: detail.job.lifecycleVersion,
                        resultJobId: detail.job.jobId,
                        observedAt: detail.job.updatedAt,
                        problem: acknowledgedProblem
                      }
                    : {
                        ...common,
                        _tag: "Committed" as const,
                        problem: acknowledgedProblem,
                        observedAt: detail.job.updatedAt
                      }
                }
                const send = (command: JobRepairCommand | JobResolutionCommand) =>
                  Effect.sync(() => {
                    sent = command
                    writes++
                    return receipt
                      ? {
                          _tag: "OutcomeUnknown" as const,
                          sandbox: command.sandbox,
                          requestId: command.requestId
                        }
                      : definitive()
                  })
                const client: Client = {
                  ...FixtureClient.client,
                  describe: () => Effect.succeed(sandbox),
                  detail: () => Effect.succeed(detail),
                  list: (request) =>
                    Effect.gen(function* () {
                      const call = ++listCalls
                      if (call === 2) {
                        yield* Deferred.succeed(entered, undefined)
                        yield* Deferred.await(release)
                      }
                      return {
                        ...Fixtures.page,
                        sandbox: request.sandbox,
                        items: [detail.job],
                        filteredTotal: 21,
                        nextCursor: request.cursor
                          ? null
                          : call <= 2
                            ? "old-next"
                            : "replacement-next"
                      }
                    }),
                  repair: (command) => send(command) as ReturnType<Client["repair"]>,
                  resolve: (command) => send(command) as ReturnType<Client["resolve"]>,
                  repairReceipt: () =>
                    Effect.sync(definitive) as ReturnType<Client["repairReceipt"]>,
                  resolutionReceipt: () =>
                    Effect.sync(definitive) as ReturnType<Client["resolutionReceipt"]>
                }
                const provide = <A>(operation: Effect.Effect<A, never, JobsClient>) =>
                  operation.pipe(Effect.provideService(JobsClient, client))
                yield* provide(state.refresh)
                yield* provide(state.select(detail.job.jobId))
                const slow = yield* Effect.forkChild(provide(state.refresh))
                yield* Deferred.await(entered)
                expect(state.snapshot().loading).toBe(true)
                const command =
                  kind === "repair"
                    ? Schema.decodeUnknownSync(JobRepairCommand)({
                        sandbox: sandbox.ref,
                        requestId: "placeholder",
                        jobId: detail.job.jobId,
                        expectedState: "Dead",
                        expectedLifecycleVersion: detail.job.lifecycleVersion,
                        expectedResolutionVersion: 0,
                        action: "redrive",
                        reason: "Synthetic repair",
                        confirmDuplicateEffects: true,
                        investigation: { _tag: "KnownFailure" }
                      })
                    : Schema.decodeUnknownSync(JobResolutionCommand)({
                        sandbox: sandbox.ref,
                        requestId: "placeholder",
                        rootJobId: detail.job.jobId,
                        expectedResolutionVersion: 0,
                        action: "manual-close",
                        reason: "Synthetic closure",
                        confirmUnknownOutcome: true
                      })
                yield* provide(state.repair(command))
                if (receipt) {
                  expect(state.snapshot().pending?.request.requestId).toBe(
                    sent!.requestId
                  )
                  expect(state.snapshot().loading).toBe(true)
                  expect(listCalls).toBe(2)
                  yield* provide(state.repair(command))
                  expect(writes).toBe(1)
                  yield* provide(state.receipt)
                }
                expect(state.snapshot().loading).toBe(false)
                expect(state.snapshot().pending).toBeUndefined()
                expect(state.snapshot().resultsCurrent).toBe(true)
                expect(state.snapshot().page?.nextCursor).toBe("replacement-next")
                yield* Deferred.succeed(release, undefined)
                yield* Fiber.join(slow)
                expect(state.reading()).toBe(false)
                expect(state.snapshot().loading).toBe(false)
                expect(state.snapshot().page?.nextCursor).toBe("replacement-next")
                const beforeRefresh = listCalls
                yield* provide(state.refresh)
                expect(listCalls).toBe(beforeRefresh + 1)
                yield* provide(state.next)
                expect(state.snapshot().pageNumber).toBe(2)
                yield* provide(state.previous)
                expect(state.snapshot().pageNumber).toBe(1)
                expect(writes).toBe(1)
              })
            )
          } finally {
            state.dispose()
          }
        })
      }
    }
  }
})
