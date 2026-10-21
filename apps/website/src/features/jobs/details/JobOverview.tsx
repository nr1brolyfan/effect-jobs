import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Badge, Panel } from "../../../ui/Primitives.js"
import { PropertyGrid, Absent } from "./PropertyGrid.js"
import { styles as propertyStyles } from "./PropertyGrid.stylex.js"
import { styles } from "./JobOverview.stylex.js"

export function JobOverview(props: { readonly detail: JobDetail }) {
  return (
    <Panel aria-label="Job overview" {...stylex.props(styles.panel)}>
      <h2 {...stylex.props(propertyStyles.heading)}>Overview</h2>
      <div {...stylex.props(styles.badges)}>
        <span>
          Execution: <Badge state={props.detail.job.state} />
        </span>
        <span {...stylex.props(styles.label)}>
          Resolution:{" "}
          {props.detail.problem
            ? props.detail.problem.state === "InProgress"
              ? "In progress"
              : props.detail.problem.state
            : "None"}
        </span>
        {props.detail.lineage && (
          <span {...stylex.props(styles.label)}>
            {props.detail.lineage.kind === "CorrectedRedrive"
              ? "Corrected redrive"
              : "Plain redrive"}
          </span>
        )}
      </div>
      <PropertyGrid
        items={[
          ...(props.detail.problem
            ? [
                {
                  label: "Outcome",
                  value:
                    props.detail.problem.outcomeKnowledge === "KnownFailure"
                      ? "Known failure"
                      : "Unknown"
                }
              ]
            : []),
          {
            label: "Attempts finalized",
            value: `${props.detail.job.attemptsMade} / ${props.detail.policy.maxAttempts}`
          },
          {
            label: "Stalled recoveries",
            value: `${props.detail.job.stalledCount} / ${props.detail.policy.maxStalledCount}`
          },
          { label: "Lifecycle version", value: props.detail.job.lifecycleVersion },
          {
            label: "Failure code",
            value: props.detail.job.lastFailureCode ?? <Absent />,
            mono: true
          },
          ...(props.detail.lineage
            ? [
                {
                  label: "Source",
                  value: props.detail.lineage.originalSourceJobId,
                  mono: true
                }
              ]
            : [])
        ]}
      />
    </Panel>
  )
}
