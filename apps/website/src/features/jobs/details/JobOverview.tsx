import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Badge, Panel } from "../../../ui/Primitives.js"
import { PropertyGrid, Absent } from "./PropertyGrid.js"
import { styles as propertyStyles } from "./PropertyGrid.stylex.js"
import { styles } from "./JobOverview.stylex.js"

export function JobOverview({ detail }: { readonly detail: JobDetail }) {
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
    </Panel>
  )
}
