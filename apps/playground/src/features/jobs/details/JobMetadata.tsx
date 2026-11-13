import { Match } from "effect"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Panel } from "../../../ui/Primitives.js"
import { PropertyGrid, Absent, DetailTime, formatDuration } from "./PropertyGrid.js"
import { styles } from "./PropertyGrid.stylex.js"

export function JobScheduling(props: { readonly detail: JobDetail }) {
  return (
    <Panel {...stylex.props(styles.panel)}>
      <h2 {...stylex.props(styles.heading)}>Scheduling</h2>
      <PropertyGrid
        items={[
          {
            label: "Available",
            value: <DetailTime value={props.detail.job.availableAt} label="Available" />
          },
          {
            label: "Updated",
            value: (
              <DetailTime value={props.detail.job.updatedAt} label="Lifecycle updated" />
            )
          },
          {
            label: "Terminal at",
            value: (
              <DetailTime
                value={props.detail.job.completedAt}
                label="Terminal completion"
              />
            )
          },
          {
            label: "Created",
            value: <DetailTime value={props.detail.createdAt} label="Creation time" />
          }
        ]}
      />
    </Panel>
  )
}

export function JobMetadata(inputProps: { readonly detail: JobDetail }) {
  const { job, producer, policy } = inputProps.detail
  return (
    <Panel {...stylex.props(styles.panel)}>
      <details>
        <summary {...stylex.props(styles.sectionSummary)}>
          Identity & execution policy
        </summary>
        <div {...stylex.props(styles.advanced)}>
          <section {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.heading)}>Identity</h2>
            <PropertyGrid
              items={[
                { label: "Job", value: job.jobId, mono: true },
                { label: "Queue", value: job.catalog.queue, mono: true },
                { label: "Name", value: job.catalog.name, mono: true },
                { label: "Schema version", value: job.catalog.version },
                { label: "Producer operation", value: producer.operation, mono: true },
                { label: "Operation identity", value: producer.operationId, mono: true },
                { label: "Slot", value: producer.slot, mono: true },
                { label: "Generation", value: inputProps.detail.sandbox.generation }
              ]}
            />
          </section>
          <section {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.heading)}>Execution policy</h2>
            <PropertyGrid
              items={[
                { label: "Finalized attempt limit", value: policy.maxFinalizedAttempts },
                { label: "Recovery limit", value: policy.maxStalledCount },
                {
                  label: "Attempt timeout",
                  value: formatDuration(policy.attemptTimeoutMillis)
                },
                {
                  label: "Lease duration",
                  value: formatDuration(policy.leaseDurationMillis)
                },
                {
                  label:
                    policy.retrySchedule._tag === "FixedDelayV1"
                      ? "Retry delay"
                      : "Retry base delay",
                  value: formatDuration(policy.retrySchedule.delayMillis)
                },
                ...(policy.retrySchedule._tag === "FixedDelayV1"
                  ? []
                  : [
                      { label: "Retry factor", value: policy.retrySchedule.factor },
                      {
                        label: "Retry cap",
                        value: formatDuration(policy.retrySchedule.maxDelayMillis)
                      },
                      {
                        label: "Retry jitter",
                        value: Match.value(policy.retrySchedule.jitter).pipe(
                          Match.when("Full", () => "Full"),
                          Match.when("ProportionalV1", () => "80–120% (bounded)"),
                          Match.when("None", () => "None"),
                          Match.exhaustive
                        )
                      }
                    ]),
                {
                  label: "Completed retention",
                  value:
                    policy.completedRetention._tag === "Forever"
                      ? "Forever"
                      : formatDuration(policy.completedRetention.millis)
                },
                {
                  label: "Dead retention",
                  value:
                    policy.deadRetention._tag === "Forever"
                      ? "Forever"
                      : formatDuration(policy.deadRetention.millis)
                }
              ]}
            />
          </section>
          <section {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.heading)}>Application relations</h2>
            <PropertyGrid
              items={[
                {
                  label: "Synthetic order",
                  value: inputProps.detail.relations.syntheticOrderId ?? <Absent />,
                  mono: true
                },
                {
                  label: "Synthetic actor",
                  value: inputProps.detail.relations.syntheticActor ?? <Absent />,
                  mono: true
                }
              ]}
            />
          </section>
        </div>
      </details>
    </Panel>
  )
}
