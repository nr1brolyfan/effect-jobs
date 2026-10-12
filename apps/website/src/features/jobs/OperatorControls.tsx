import { useEffect, useRef, useState } from "react"
import * as stylex from "@stylexjs/stylex"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { JobOperatorAction } from "@effect-jobs/playground-contracts/Operators"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { Button } from "../../ui/Primitives.js"
import type { Runtime } from "./Runtime.js"
import * as Eligibility from "./OperatorEligibility.js"
import { styles } from "./OperatorControls.stylex.js"

const labels = {
  "retry-now": "Retry now",
  cancel: "Cancel job",
  redrive: "Redrive as new job"
} as const
export const OperatorControls = ({
  runtime,
  detail,
  sandbox,
  now,
  blocked
}: {
  readonly runtime: Runtime
  readonly detail: JobDetail
  readonly sandbox: SandboxView
  readonly now: number
  readonly blocked: boolean
}) => {
  const [action, setAction] = useState<JobOperatorAction | undefined>(undefined)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const available = Eligibility.eligibility(detail, sandbox, now)
  useEffect(() => {
    const element = dialog.current
    if (action !== undefined && element && !element.open) {
      element.showModal()
    }
    return () => {
      if (element?.open) {
        element.close()
      }
    }
  }, [action])
  const dismiss = () => {
    dialog.current?.close()
    setAction(undefined)
    trigger.current?.focus({ preventScroll: true })
  }
  const confirm = () => {
    if (action === undefined || blocked) {
      return
    }
    const state = runtime.snapshot()
    if (
      state.detail?.job.jobId !== detail.job.jobId ||
      state.detail.job.lifecycleVersion !== detail.job.lifecycleVersion ||
      state.sandbox.ref.sandboxId !== sandbox.ref.sandboxId ||
      state.sandbox.ref.generation !== sandbox.ref.generation
    ) {
      dismiss()
      return
    }
    void runtime.run(runtime.operate(action, crypto.randomUUID(), action === "redrive"))
    dismiss()
  }
  return (
    <section {...stylex.props(styles.panel)} aria-label="Job operators">
      <div {...stylex.props(styles.actions)}>
        {(["retry-now", "cancel", "redrive"] as const).map((value) => {
          const entry =
            value === "retry-now"
              ? available.retryNow
              : value === "cancel"
                ? available.cancel
                : available.redrive
          return (
            <Button
              key={value}
              disabled={blocked || !entry.enabled}
              aria-describedby={`operator-${value}-reason`}
              onClick={(event) => {
                trigger.current = event.currentTarget
                setAction(value)
              }}
            >
              {labels[value]}
            </Button>
          )
        })}
      </div>
      {(["retry-now", "cancel", "redrive"] as const).map((value) => {
        const entry =
          value === "retry-now"
            ? available.retryNow
            : value === "cancel"
              ? available.cancel
              : available.redrive
        return (
          <p
            key={value}
            id={`operator-${value}-reason`}
            {...stylex.props(styles.explanation)}
          >
            {labels[value]}: {Eligibility.explanation(entry.reason)}
            {value === "redrive" && entry.enabled
              ? " Full artifact and private subject/tenant validation occurs on submission; eligibility does not prove the artifact is valid."
              : ""}
          </p>
        )
      })}
      <dialog
        ref={dialog}
        aria-labelledby="operator-confirm-title"
        aria-describedby="operator-confirm-warning"
        {...stylex.props(styles.dialog)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
          }
        }}
        onCancel={(event) => {
          event.preventDefault()
          dismiss()
        }}
      >
        <h3 id="operator-confirm-title" {...stylex.props(styles.heading)}>
          {action === undefined ? "Confirm operator" : labels[action]}
        </h3>
        <p id="operator-confirm-warning" {...stylex.props(styles.warning)}>
          {action === "redrive"
            ? "The original may already have produced external effects, especially after a stalled or isolated attempt. This creates a new job ID with a fresh retry budget and can repeat those effects. The original remains unchanged. Confirm only after investigating its outcome."
            : action === "cancel"
              ? "Prevent future execution of this pending or scheduled job? Cancellation cannot undo effects that already happened. Active execution cannot be safely interrupted."
              : "Make this future scheduled retry eligible now? The same job ID, retry budget and payload are preserved. This does not guarantee immediate execution."}
        </p>
        <div {...stylex.props(styles.actions)}>
          <Button autoFocus onClick={dismiss}>
            Keep current job
          </Button>
          <Button disabled={blocked} onClick={confirm}>
            {action === "redrive"
              ? "Confirm possible duplicate effects"
              : "Confirm action"}
          </Button>
        </div>
      </dialog>
    </section>
  )
}
