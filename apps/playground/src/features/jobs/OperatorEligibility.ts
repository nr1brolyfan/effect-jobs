import { Match } from "effect"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type {
  JobOperatorEligibility,
  JobOperatorReason
} from "@effect-jobs/playground-contracts/Operators"

const denied = (reason: JobOperatorReason) => ({ enabled: false, reason })
const allowed = { enabled: true, reason: null }
// Browser metadata only. DB-time/source/artifact checks remain server authority.
export const eligibility = (
  detail: JobDetail,
  view: SandboxView,
  now: number
): JobOperatorEligibility => {
  const state = detail.job.state
  const active = state === "Active"
  return {
    retryNow: !view.capabilities.retryJob
      ? denied("public-read-only")
      : active
        ? denied("active-execution")
        : state !== "RetryScheduled"
          ? denied("not-eligible")
          : detail.job.availableAt <= now
            ? denied("already-due")
            : allowed,
    cancel: !view.capabilities.cancelJob
      ? denied("public-read-only")
      : active
        ? denied("active-execution")
        : state === "Pending" || state === "RetryScheduled"
          ? allowed
          : denied("terminal-state"),
    redrive: !view.capabilities.redriveJob
      ? denied("public-read-only")
      : active
        ? denied("active-execution")
        : state === "Dead" || state === "Isolated"
          ? allowed
          : denied("not-eligible")
  }
}
export const explanation = (reason: JobOperatorReason | null): string =>
  Match.value(reason).pipe(
    Match.when(null, () => "Eligibility is checked again by the server."),
    Match.when(
      "public-read-only",
      () => "Operators are unavailable in this session. Public demo is read-only."
    ),
    Match.when(
      "active-execution",
      () =>
        "The handler may already be executing. Safe interruption is unavailable; reconcile or recover the original job first."
    ),
    Match.when("already-due", () => "This retry is already eligible for execution."),
    Match.when(
      "terminal-state",
      () => "This job is already terminal. Past effects cannot be undone."
    ),
    Match.whenOr(
      "invalid-input",
      "not-found",
      "state-version-conflict",
      "not-eligible",
      "invalid-artifact",
      "policy-incompatible",
      "unsupported-catalog",
      "arithmetic-bound",
      "investigation-required",
      "exhausted-budget",
      "unavailable",
      "limit-reached",
      () => "This action is unavailable for the current state."
    ),
    Match.exhaustive
  )

// Detail eligibility is server-projected semantic metadata, never busy/unlock state.
export const repairApplicability = (detail: JobDetail, readOnly: boolean) => ({
  redrive: !readOnly && detail.eligibility.redrive.enabled,
  correct: !readOnly && detail.eligibility.correctedRedrive.enabled,
  resolve: !readOnly && detail.problem !== null && detail.problem.state !== "Resolved"
})
