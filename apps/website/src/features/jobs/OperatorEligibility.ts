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
export const explanation = (reason: JobOperatorReason | null): string => {
  switch (reason) {
    case null:
      return "Eligibility is checked again by the server."
    case "public-read-only":
      return "Operators are unavailable in this session. Public demo is read-only."
    case "active-execution":
      return "The handler may already be executing. Safe interruption is unavailable; reconcile or recover the original job first."
    case "already-due":
      return "This retry is already eligible for execution."
    case "terminal-state":
      return "This job is already terminal. Past effects cannot be undone."
    default:
      return "This action is unavailable for the current state."
  }
}
