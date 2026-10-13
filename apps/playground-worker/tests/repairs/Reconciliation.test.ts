import { describe, expect, it } from "vitest"
import * as Reconciliation from "../../src/execution/RepairReconciliation.js"
import * as Persistence from "../../src/persistence/commands/RepairPersistence.js"
import * as Fixture from "./Fixtures.js"

describe("one durable chain problem", () => {
  for (const state of ["Pending", "RetryScheduled", "Active"] as const) {
    it(`keeps ${state} in progress`, () =>
      expect(
        Reconciliation.effectiveProblem(
          Fixture.problem,
          { jobId: Fixture.successorId, state, lifecycleVersion: 0 },
          1100
        )
      ).toBe(Fixture.problem))
  }
  for (const state of ["Dead", "Isolated", "Cancelled"] as const) {
    it(`reopens ${state} once and preserves root/tip`, () => {
      const next = Reconciliation.effectiveProblem(
        Fixture.problem,
        { jobId: Fixture.successorId, state, lifecycleVersion: 1 },
        1100
      )
      expect(next).toMatchObject({
        state: "Open",
        rootJobId: Fixture.sourceId,
        activeSuccessorJobId: Fixture.successorId,
        version: 2,
        resolution: null
      })
      expect(
        Reconciliation.effectiveProblem(
          next,
          { jobId: Fixture.successorId, state, lifecycleVersion: 1 },
          1200
        )
      ).toBe(next)
    })
  }
  it("resolves only a completed current known-failure successor", () => {
    const current = {
      jobId: Fixture.successorId,
      state: "Completed" as const,
      lifecycleVersion: 1
    }
    expect(Reconciliation.effectiveProblem(Fixture.problem, current, 1100)).toMatchObject(
      {
        state: "Resolved",
        version: 2,
        resolution: { kind: "SuccessorCompleted", reason: null }
      }
    )
    expect(
      Reconciliation.effectiveProblem(
        { ...Fixture.problem, outcomeKnowledge: "Unknown" },
        current,
        1100
      )
    ).toMatchObject({ state: "Open", outcomeKnowledge: "Unknown", resolution: null })
    expect(
      Reconciliation.effectiveProblem(
        Fixture.problem,
        { ...current, jobId: Fixture.sourceId },
        1100
      )
    ).toBe(Fixture.problem)
    expect(Reconciliation.effectiveProblem(Fixture.problem, null, 1100)).toMatchObject({
      state: "Open",
      resolution: null
    })
  })
  it("does not reopen an already resolved/manual closed chain", () => {
    const closed = {
      ...Fixture.problem,
      state: "Resolved" as const,
      resolution: {
        kind: "ManualClose" as const,
        reason: "Operator closed",
        observedAt: 1050,
        successorJobId: Fixture.successorId
      }
    }
    expect(
      Reconciliation.effectiveProblem(
        closed,
        { jobId: Fixture.successorId, state: "Dead", lifecycleVersion: 2 },
        1100
      )
    ).toBe(closed)
    expect(Reconciliation.effectiveProblem(closed, null, 1100)).toBe(closed)
  })
  it("refuses stale ancestor, competing repair, resolved and version mismatches", () => {
    expect(
      Persistence.refuseProblem(Fixture.problem, {
        ...Fixture.command,
        expectedResolutionVersion: 1
      })
    ).toBe("repair-in-progress")
    const failed = { ...Fixture.problem, state: "Open" as const, version: 2 }
    expect(
      Persistence.refuseProblem(failed, {
        ...Fixture.command,
        expectedResolutionVersion: 2
      })
    ).toBe("resolution-conflict")
    expect(
      Persistence.refuseProblem(failed, {
        ...Fixture.command,
        jobId: Fixture.successorId,
        expectedResolutionVersion: 2
      })
    ).toBeNull()
    expect(
      Persistence.refuseProblem(
        { ...failed, state: "Resolved" },
        { ...Fixture.command, expectedResolutionVersion: 2 }
      )
    ).toBe("already-resolved")
  })
})
