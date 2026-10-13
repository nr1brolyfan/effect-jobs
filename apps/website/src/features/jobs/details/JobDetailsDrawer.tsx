import { Dialog } from "@base-ui/react/dialog"
import * as stylex from "@stylexjs/stylex"
import { useState } from "react"
import { Button } from "../../../ui/Primitives.js"
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
  const [returnFocus] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement
  )
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
          finalFocus={() =>
            returnFocus instanceof HTMLElement && returnFocus.isConnected
              ? returnFocus
              : document.querySelector<HTMLElement>("[data-jobs-focus-fallback]")
          }
        >
          <header {...stylex.props(styles.header)}>
            <Dialog.Title>Quick job details</Dialog.Title>
            <Button aria-label="Close job details" onClick={() => leave(onClose)}>
              Close
            </Button>
          </header>
          <Dialog.Description>
            Current retained facts for job {detail.job.jobId}.
          </Dialog.Description>
          {open && (
            <div {...stylex.props(styles.content)}>
              <JobOverview detail={detail} />
              {payloadSlot}
              {repairSlot}
              <Button variant="primary" onClick={() => leave(onOpenFull)}>
                Open full details
              </Button>
              {detail.lineage?.sourceJobId && (
                <Button
                  onClick={() => leave(() => onRelated(detail.lineage!.sourceJobId!))}
                >
                  Open source job
                </Button>
              )}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
