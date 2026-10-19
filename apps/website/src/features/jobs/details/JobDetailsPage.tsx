import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { JobId } from "effect-jobs/JobId"
import type { ReactNode } from "react"
import * as stylex from "@stylexjs/stylex"
import { Button } from "../../../ui/Primitives.js"
import { JobMetadata, JobScheduling } from "./JobMetadata.js"
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
  const { job } = detail
  return (
    <main aria-label="Job details" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <h1 {...stylex.props(styles.title)} tabIndex={-1} data-job-details-heading="">
            Job details
          </h1>
          <p {...stylex.props(styles.identity)}>{job.jobId}</p>
        </div>
        <Button onClick={onClose}>Back to jobs</Button>
      </header>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.sections)}>
          <JobOverview detail={detail} />
          <JobScheduling detail={detail} />
          <div
            key={detailIdentityKey(detail)}
            {...stylex.props(styles.slots, !repairSlot && styles.payloadOnly)}
          >
            {payloadSlot}
            {repairSlot}
          </div>
          <JobTimeline detail={detail} />
          <JobRelatedJobs detail={detail} onRelated={onRelated} />
        </div>
        <aside aria-label="Job metadata" {...stylex.props(styles.metadata)}>
          <JobMetadata detail={detail} />
        </aside>
      </div>
    </main>
  )
}
