import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { JobId } from "effect-jobs/JobId"
import type { ReactNode } from "react"
import * as stylex from "@stylexjs/stylex"
import { Button, Panel } from "../../../ui/Primitives.js"
import { DateTime } from "../../../ui/DateTime.js"
import { JobOverview } from "./JobOverview.js"
import { JobTimeline } from "./JobTimeline.js"
import { JobRelatedJobs } from "./JobRelatedJobs.js"
import { styles } from "./JobDetailsPage.stylex.js"

export interface JobDetailsProps {
  readonly detail: JobDetail
  readonly now: number
  readonly onClose: () => void
  readonly onOpenFull: () => void
  readonly onRelated: (jobId: JobId) => void
  readonly payloadSlot: ReactNode
  readonly repairSlot: ReactNode
}

export const detailIdentityKey = (detail: JobDetail) =>
  JSON.stringify([detail.sandbox.sandboxId, detail.sandbox.generation, detail.job.jobId])

export function JobDetailsPage({
  detail,
  onClose,
  onRelated,
  payloadSlot,
  repairSlot
}: JobDetailsProps) {
  const { job, policy, producer } = detail
  return (
    <main aria-label="Job details" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <h1 tabIndex={-1} data-job-details-heading="">
            Job details
          </h1>
          <p {...stylex.props(styles.identity)}>{job.jobId}</p>
        </div>
        <Button onClick={onClose}>Back to jobs</Button>
      </header>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.sections)}>
          <JobOverview detail={detail} />
          <div key={detailIdentityKey(detail)} {...stylex.props(styles.sections)}>
            {payloadSlot}
            {repairSlot}
          </div>
          <JobTimeline detail={detail} />
          <JobRelatedJobs detail={detail} onRelated={onRelated} />
        </div>
        <aside aria-label="Job metadata" {...stylex.props(styles.sections)}>
          <Panel {...stylex.props(styles.metadata)}>
            <h2>Identity</h2>
            <dl {...stylex.props(styles.facts)}>
              <dt>Job</dt>
              <dd>{job.jobId}</dd>
              <dt>Queue</dt>
              <dd>{job.catalog.queue}</dd>
              <dt>Kind</dt>
              <dd>{job.catalog.kind}</dd>
              <dt>Schema version</dt>
              <dd>{job.catalog.version}</dd>
              <dt>Producer operation</dt>
              <dd>{producer.operation}</dd>
              <dt>Operation identity</dt>
              <dd>{producer.operationId}</dd>
              <dt>Slot</dt>
              <dd>{producer.slot}</dd>
              <dt>Generation</dt>
              <dd>{detail.sandbox.generation}</dd>
            </dl>
          </Panel>
          <Panel {...stylex.props(styles.metadata)}>
            <h2>Scheduling</h2>
            <dl {...stylex.props(styles.facts)}>
              <dt>Created</dt>
              <dd>Unavailable: not stored</dd>
              <dt>Available</dt>
              <dd>
                <DateTime value={job.availableAt} />
              </dd>
              <dt>Lifecycle updated</dt>
              <dd>
                <DateTime value={job.updatedAt} />
              </dd>
              <dt>Terminal completion</dt>
              <dd>
                <DateTime value={job.completedAt} />
              </dd>
            </dl>
            <p>Availability and lifecycle update times are not creation times.</p>
          </Panel>
          <Panel {...stylex.props(styles.metadata)}>
            <h2>Persisted policy</h2>
            <dl {...stylex.props(styles.facts)}>
              <dt>Attempt limit</dt>
              <dd>{policy.maxAttempts}</dd>
              <dt>Stalled recovery limit</dt>
              <dd>{policy.maxStalledCount}</dd>
              <dt>Attempt timeout</dt>
              <dd>{policy.attemptTimeoutMillis} ms</dd>
              <dt>Lease duration</dt>
              <dd>{policy.leaseDurationMillis} ms</dd>
              <dt>Fixed retry delay</dt>
              <dd>{policy.retrySchedule.delayMillis} ms</dd>
              <dt>Completed retention</dt>
              <dd>
                {policy.completedRetention._tag === "Forever"
                  ? "Forever"
                  : `${policy.completedRetention.millis} ms`}
              </dd>
              <dt>Dead retention</dt>
              <dd>
                {policy.deadRetention._tag === "Forever"
                  ? "Forever"
                  : `${policy.deadRetention.millis} ms`}
              </dd>
            </dl>
            <p>Isolated jobs are not automatically purged.</p>
          </Panel>
          <Panel {...stylex.props(styles.metadata)}>
            <h2>Application relations</h2>
            <dl {...stylex.props(styles.facts)}>
              <dt>Synthetic order</dt>
              <dd>{detail.relations.syntheticOrderId ?? "Not recorded"}</dd>
              <dt>Synthetic actor</dt>
              <dd>{detail.relations.syntheticActor ?? "Not recorded"}</dd>
            </dl>
          </Panel>
        </aside>
      </div>
    </main>
  )
}
