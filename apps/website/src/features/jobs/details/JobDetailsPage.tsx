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

export function JobDetailsPage(props: JobDetailsProps) {
  const { job } = props.detail
  return (
    <main aria-label="Job details" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <h1 {...stylex.props(styles.title)} tabIndex={-1} data-job-details-heading="">
            Job details
          </h1>
          <p {...stylex.props(styles.identity)}>{job.jobId}</p>
        </div>
        <Button onClick={props.onClose}>Back to jobs</Button>
      </header>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.sections)}>
          <JobOverview detail={props.detail} />
          <JobScheduling detail={props.detail} />
          <div
            key={detailIdentityKey(props.detail)}
            {...stylex.props(styles.slots, !props.repairSlot && styles.payloadOnly)}
          >
            {props.payloadSlot}
            {props.repairSlot}
          </div>
          <JobTimeline detail={props.detail} />
          <JobRelatedJobs detail={props.detail} onRelated={props.onRelated} />
        </div>
        <aside aria-label="Job metadata" {...stylex.props(styles.metadata)}>
          <JobMetadata detail={props.detail} />
        </aside>
      </div>
    </main>
  )
}
