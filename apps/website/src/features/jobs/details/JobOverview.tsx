import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Badge, Panel } from "../../../ui/Primitives.js"
import { styles } from "./JobOverview.stylex.js"

// Only allowlisted codes receive an explanation; never echo provider messages.
export function causeAndNextStep(detail: JobDetail) {
  const { job, problem } = detail
  if (job.state === "Dead" || job.state === "Isolated") {
    if (problem?.outcomeKnowledge === "KnownFailure") {
      return {
        cause: "Retained evidence identifies a known failure.",
        next: "Inspect the payload and repair eligibility. A successor has a fresh budget; the source stays unchanged."
      }
    }
    return {
      cause: "The external outcome is unknown or has insufficient retained evidence.",
      next: "Reconcile external effects before choosing a repair. Replaying can duplicate effects."
    }
  }
  switch (job.state) {
    case "Completed":
      return {
        cause: "Execution completed.",
        next: "Review retained evidence and related jobs. Completion does not imply a stored handler result."
      }
    case "Cancelled":
      return {
        cause: "Future execution was cancelled.",
        next: "Cancellation cannot undo earlier external effects."
      }
    case "Active":
      return {
        cause: "The worker currently owns execution.",
        next: "Wait for a confirmed lifecycle update; active interruption is unavailable."
      }
    case "RetryScheduled":
      return {
        cause: "A retry is scheduled.",
        next: "Review availability and the retained failure code. Counters describe confirmed finalizations."
      }
    case "Pending":
      return {
        cause: "The job is waiting for execution.",
        next: "Review availability and the persisted execution policy."
      }
  }
}

export function JobOverview({ detail }: { readonly detail: JobDetail }) {
  const explanation = causeAndNextStep(detail)
  return (
    <Panel aria-label="Job overview" {...stylex.props(styles.panel)}>
      <h2>Overview</h2>
      <div {...stylex.props(styles.badges)}>
        <span>
          Execution: <Badge state={detail.job.state} />
        </span>
        <span {...stylex.props(styles.label)}>
          Resolution:{" "}
          {detail.problem
            ? detail.problem.state === "InProgress"
              ? "In progress"
              : detail.problem.state
            : "No recorded problem"}
        </span>
        {detail.lineage && (
          <span {...stylex.props(styles.label)}>
            {detail.lineage.kind === "CorrectedRedrive"
              ? "Corrected redrive"
              : "Plain redrive"}
          </span>
        )}
      </div>
      <p>{explanation.cause}</p>
      <p>
        <strong>Next step:</strong> {explanation.next}
      </p>
      <dl {...stylex.props(styles.counters)}>
        <dt>Confirmed finalized attempts</dt>
        <dd>
          {detail.job.attemptsMade} / {detail.policy.maxAttempts}
        </dd>
        <dt>Stalled recoveries</dt>
        <dd>
          {detail.job.stalledCount} / {detail.policy.maxStalledCount}
        </dd>
        <dt>Lifecycle version</dt>
        <dd>{detail.job.lifecycleVersion}</dd>
        <dt>Last recorded failure code</dt>
        <dd>{detail.job.lastFailureCode ?? "Not recorded"}</dd>
      </dl>
      <p {...stylex.props(styles.note)}>
        Unknown outcomes can repeat an attempt number. These counters are not a complete
        invocation history.
      </p>
      {detail.problem && (
        <p>
          Needs attention counts unresolved problems once per repair chain. Resolution is
          separate from execution state.
        </p>
      )}
      {detail.lineage && (
        <p>
          Source: <code>{detail.lineage.originalSourceJobId}</code>.{" "}
          {detail.lineage.sourceJobId === null
            ? "Source no longer retained; its payload, diff and history are unavailable."
            : "Source identity retained."}
        </p>
      )}
    </Panel>
  )
}
