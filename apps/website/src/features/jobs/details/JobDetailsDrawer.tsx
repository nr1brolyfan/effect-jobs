import { Dialog } from "@base-ui/react/dialog"
import * as stylex from "@stylexjs/stylex"
import { useState } from "react"
import { Button } from "../../../ui/Primitives.js"
import { JobTimeline } from "./JobTimeline.js"
import { JobRelatedJobs } from "./JobRelatedJobs.js"
import { JobMetadata, JobScheduling } from "./JobMetadata.js"
import { JobOverview } from "./JobOverview.js"
import { detailIdentityKey, type JobDetailsProps } from "./JobDetailsPage.js"
import { styles } from "./JobDetailsDrawer.stylex.js"

export function JobDetailsDrawer(props: JobDetailsProps) {
  // A selected identity gets its own dialog lifetime, including volatile slots.
  return <SelectedDrawer key={detailIdentityKey(props.detail)} {...props} />
}

function SelectedDrawer({
  detail,
  onClose,
  onOpenFull,
  onRelated,
  payloadSlot,
  repairSlot
}: JobDetailsProps) {
  const [open, setOpen] = useState(true)
  const leave = (action: () => void) => {
    setOpen(false)
    action()
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          leave(onClose)
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          {...stylex.props(styles.drawer)}
          // Detail reads and live list renders can replace the original opener
          // before this dialog mounts. Resolve the selected identity on close;
          // a captured activeElement may be BODY or an unrelated control.
          finalFocus={() =>
            Array.from(
              document.querySelectorAll<HTMLElement>("button[data-job-id]")
            ).find((button) => button.dataset.jobId === detail.job.jobId) ??
            document.querySelector<HTMLElement>("[data-jobs-focus-fallback]")
          }
        >
          <header {...stylex.props(styles.header)}>
            <Dialog.Title {...stylex.props(styles.title)}>Quick job details</Dialog.Title>
            <Button aria-label="Close job details" onClick={() => leave(onClose)}>
              Close
            </Button>
          </header>
          <Dialog.Description {...stylex.props(styles.identity)}>
            {detail.job.jobId}
          </Dialog.Description>
          {open && (
            <div {...stylex.props(styles.content)}>
              <JobOverview detail={detail} />
              <JobScheduling detail={detail} />
              {payloadSlot}
              {repairSlot}
              <JobTimeline detail={detail} />
              <JobRelatedJobs
                detail={detail}
                onRelated={(jobId) => leave(() => onRelated(jobId))}
              />
              <JobMetadata detail={detail} />
              <Button variant="primary" onClick={() => leave(onOpenFull)}>
                Open full details
              </Button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
