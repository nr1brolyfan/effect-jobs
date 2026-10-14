import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Badge, Panel } from "../../../ui/Primitives.js"
import { PropertyGrid, Absent, DetailHelp } from "./PropertyGrid.js"
import { styles as propertyStyles } from "./PropertyGrid.stylex.js"
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
      <h2 {...stylex.props(propertyStyles.heading)}>Overview</h2>
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
            : "None"}
        </span>
        {detail.lineage && (
          <span {...stylex.props(styles.label)}>
            {detail.lineage.kind === "CorrectedRedrive"
              ? "Corrected redrive"
              : "Plain redrive"}
          </span>
        )}
      </div>
      <PropertyGrid
        items={[
          ...(detail.problem
            ? [
                {
                  label: "Outcome",
                  value:
                    detail.problem.outcomeKnowledge === "KnownFailure"
                      ? "Known failure"
                      : "Unknown"
                }
              ]
            : []),
          {
            label: "Attempts finalized",
            value: `${detail.job.attemptsMade} / ${detail.policy.maxAttempts}`
          },
          {
            label: "Stalled recoveries",
            value: `${detail.job.stalledCount} / ${detail.policy.maxStalledCount}`
          },
          { label: "Lifecycle version", value: detail.job.lifecycleVersion },
          {
            label: "Failure code",
            value: detail.job.lastFailureCode ?? <Absent />,
            mono: true
          },
          ...(detail.lineage
            ? [{ label: "Source", value: detail.lineage.originalSourceJobId, mono: true }]
            : [])
        ]}
      />
      <DetailHelp summary="Status & next step">
        {explanation.cause} {explanation.next}
      </DetailHelp>
      <DetailHelp summary="About counters & resolution">
        Attempts count confirmed finalizations; unknown outcomes can repeat an attempt
        number. These are not a complete invocation history. Resolution is separate from
        execution; unresolved problems are counted once per repair chain.
        {detail.lineage?.sourceJobId === null &&
          " Source no longer retained; its payload, diff and history are unavailable."}
      </DetailHelp>
    </Panel>
  )
}
