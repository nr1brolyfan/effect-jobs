import { describe, expect, it } from "vitest"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as Fixture from "../../../../playground-worker/tests/repairs/Fixtures.js"
import * as Projection from "../../../src/server/read/JobDetailsProjection.js"
import * as Eligibility from "../../../src/features/jobs/OperatorEligibility.js"

const sandbox = {
  ref: Fixture.ref,
  expiresAt: 10000,
  capabilities: {
    runScenario: true,
    resetSandbox: true,
    retryJob: true,
    cancelJob: true,
    redriveJob: true
  }
}
const states = [
  "Pending",
  "RetryScheduled",
  "Active",
  "Completed",
  "Dead",
  "Isolated",
  "Cancelled"
] as const

describe("source-projected action applicability", () => {
  for (const state of states) {
    for (const resolution of [null, "Open", "InProgress", "Resolved"] as const) {
      it(`${state}/${resolution ?? "no problem"}: semantic actions and public admission`, () => {
        const problem =
          resolution && Fixture.detail.problem
            ? {
                ...Fixture.detail.problem,
                state: resolution
              }
            : null
        const job = { ...Fixture.detail.job, state, availableAt: 2000 }
        const detail: JobDetail = {
          ...Fixture.detail,
          job,
          problem,
          eligibility: Projection.eligibility({ job }, problem, Fixture.detail.payload)
        }
        const terminalFailure = state === "Dead" || state === "Isolated"
        const repair = terminalFailure && (resolution === null || resolution === "Open")
        expect(Eligibility.repairApplicability(detail, false)).toEqual({
          redrive: repair,
          correct: repair,
          resolve: resolution !== null && resolution !== "Resolved"
        })
        const operators = Eligibility.eligibility(detail, sandbox, 1000)
        expect(operators.retryNow.enabled).toBe(state === "RetryScheduled")
        expect(operators.cancel.enabled).toBe(
          state === "Pending" || state === "RetryScheduled"
        )
        expect(Eligibility.repairApplicability(detail, true)).toEqual({
          redrive: false,
          correct: false,
          resolve: false
        })
        const publicView = {
          ...sandbox,
          capabilities: {
            ...sandbox.capabilities,
            retryJob: false,
            cancelJob: false,
            redriveJob: false
          }
        }
        expect(
          Object.values(Eligibility.eligibility(detail, publicView, 1000)).every(
            (entry) => !entry.enabled
          )
        ).toBe(true)
        if (state === "RetryScheduled") {
          expect(Eligibility.eligibility(detail, sandbox, 2000).retryNow).toEqual({
            enabled: false,
            reason: "already-due"
          })
        }
      })
    }
  }
})
