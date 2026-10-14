import { useEffect, useId, useRef, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import * as stylex from "@stylexjs/stylex"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type {
  JobRepairCommand,
  JobResolutionCommand,
  Investigation
} from "@effect-jobs/playground-contracts/Repairs"
import { Button, Field } from "../../../ui/Primitives.js"
import * as PayloadDiff from "./PayloadDiff.js"
import { styles } from "./JobRepairPanel.stylex.js"

export interface Props {
  readonly detail: JobDetail
  readonly readOnly: boolean
  readonly pending: JobRepairCommand | null
  readonly onSubmit: (command: JobRepairCommand) => void
  readonly onReceipt: () => void
  readonly onResolve: (command: JobResolutionCommand) => void
}
// Ephemeral form state only. The existing Atom integrator owns request/outcome
// identity, immutable pending commands, network and authoritative refresh.
export const JobRepairPanel = (props: Props) => {
  const identity = `${props.detail.sandbox.sandboxId}:${props.detail.sandbox.generation}:${props.detail.job.jobId}`
  return <RepairForm key={identity} {...props} />
}
const RepairForm = ({
  detail,
  readOnly,
  pending,
  onSubmit,
  onReceipt,
  onResolve
}: Props) => {
  const [action, setAction] = useState<
    "redrive" | "corrected-redrive" | "manual-close" | "reconcile-applied" | null
  >(null)
  const [reason, setReason] = useState("")
  const [investigation, setInvestigation] = useState<Investigation["_tag"]>("Unconfirmed")
  const [investigationReason, setInvestigationReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [unknownConfirmed, setUnknownConfirmed] = useState(false)
  const [editor, setEditor] = useState("")
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const description = useId()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLElement | null>(null)
  const submitted = useRef(false)
  const versionKey = `${detail.job.lifecycleVersion}:${detail.problem?.version ?? 0}:${readOnly}`
  const close = () => {
    setAction(null)
    setReason("")
    setInvestigation("Unconfirmed")
    setInvestigationReason("")
    setConfirmed(false)
    setUnknownConfirmed(false)
    setEditor("")
    setSnapshot(null)
  }
  useEffect(() => {
    if (action !== null && snapshot !== versionKey) {
      close()
    }
  }, [versionKey, action, snapshot])
  const correction =
    action === "corrected-redrive" ? PayloadDiff.parseReplacement(detail, editor) : null
  const resolving = action === "manual-close" || action === "reconcile-applied"
  const investigationValid =
    investigation === "KnownFailure" ||
    ((investigation === "ConfirmedNotApplied" ||
      investigation === "AcceptDuplicateRisk") &&
      PayloadDiff.validReason(investigationReason))
  const disabled =
    readOnly ||
    pending !== null ||
    snapshot !== versionKey ||
    !PayloadDiff.validReason(reason) ||
    (resolving
      ? action === "manual-close" &&
        detail.problem?.outcomeKnowledge === "Unknown" &&
        !unknownConfirmed
      : !confirmed ||
        !investigationValid ||
        (action === "corrected-redrive" && !correction?.valid))
  const begin = (next: NonNullable<typeof action>, button: HTMLButtonElement) => {
    trigger.current = button
    submitted.current = false
    setSnapshot(versionKey)
    setAction(next)
    setEditor(
      detail.payload._tag === "Available" && detail.payload.encryption === "None"
        ? JSON.stringify(detail.payload.encoded, null, 2)
        : ""
    )
  }
  const submit = () => {
    if (disabled || action === null || submitted.current) {
      return
    }
    submitted.current = true
    // Identity allocated once on deliberate submission, then handed immediately
    // to Atom ownership. Unknown receipts never regenerate this identity.
    const requestId = crypto.randomUUID()
    if (resolving) {
      if (!detail.problem) {
        return
      }
      onResolve({
        sandbox: detail.sandbox,
        requestId,
        rootJobId: detail.problem.rootJobId,
        expectedResolutionVersion: detail.problem.version,
        reason,
        action: action as "manual-close" | "reconcile-applied",
        ...(unknownConfirmed ? { confirmUnknownOutcome: true as const } : {})
      })
    } else {
      if (detail.job.state !== "Dead" && detail.job.state !== "Isolated") {
        return
      }
      const checkedInvestigation: Investigation =
        investigation === "KnownFailure"
          ? { _tag: "KnownFailure" }
          : investigation === "ConfirmedNotApplied"
            ? { _tag: "ConfirmedNotApplied", reason: investigationReason }
            : { _tag: "AcceptDuplicateRisk", reason: investigationReason }
      const base = {
        sandbox: detail.sandbox,
        requestId,
        jobId: detail.job.jobId,
        expectedState: detail.job.state,
        expectedLifecycleVersion: detail.job.lifecycleVersion,
        expectedResolutionVersion: detail.problem?.version ?? 0,
        reason,
        confirmDuplicateEffects: true as const,
        investigation: checkedInvestigation
      }
      if (action === "corrected-redrive" && correction?.valid) {
        onSubmit({ ...base, action, payload: correction.payload })
      } else if (action === "redrive") {
        onSubmit({ ...base, action })
      }
    }
    close()
  }
  return (
    <section
      ref={panel}
      tabIndex={-1}
      {...stylex.props(styles.panel)}
      aria-label="Repair and resolution"
    >
      <h3 {...stylex.props(styles.heading)}>Repair and resolution</h3>
      {readOnly ? (
        <p {...stylex.props(styles.explanation)}>Read only</p>
      ) : pending ? (
        <div role="status">
          <p>
            The outcome of request {pending.requestId} is unconfirmed. Check its exact
            receipt before taking another action.
          </p>
          <Button onClick={onReceipt}>Check repair receipt</Button>
        </div>
      ) : (
        <div {...stylex.props(styles.actions)}>
          <Button
            disabled={!detail.eligibility.redrive.enabled}
            onClick={(event) => begin("redrive", event.currentTarget)}
          >
            Redrive as new job
          </Button>
          <Button
            disabled={!detail.eligibility.correctedRedrive.enabled}
            onClick={(event) => begin("corrected-redrive", event.currentTarget)}
          >
            Correct and redrive
          </Button>
          <Button
            disabled={!detail.problem || detail.problem.state === "Resolved"}
            onClick={(event) => begin("reconcile-applied", event.currentTarget)}
          >
            Reconcile applied effect
          </Button>
          <Button
            disabled={!detail.problem || detail.problem.state === "Resolved"}
            onClick={(event) => begin("manual-close", event.currentTarget)}
          >
            Close problem
          </Button>
        </div>
      )}
      <Dialog.Root
        open={action !== null && !readOnly && pending === null}
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
          <Dialog.Popup
            finalFocus={() =>
              trigger.current?.isConnected && !trigger.current.disabled
                ? trigger.current
                : panel.current
            }
            {...stylex.props(styles.popup)}
          >
            <Dialog.Title {...stylex.props(styles.heading)}>
              {resolving ? "Resolve this problem" : "Confirm a new repair job"}
            </Dialog.Title>
            <Dialog.Description id={description} {...stylex.props(styles.explanation)}>
              {resolving
                ? "This records an operator assertion and never changes execution state or provider evidence."
                : "External effects may repeat. A new job gets a fresh budget; the source stays unchanged."}
            </Dialog.Description>
            <form
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <Field label="Reason (synthetic context only)">
                <textarea
                  value={reason}
                  maxLength={512}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              {!resolving && (
                <>
                  <Field label="Investigation">
                    <select
                      value={investigation}
                      onChange={(event) =>
                        setInvestigation(event.target.value as Investigation["_tag"])
                      }
                    >
                      <option value="Unconfirmed">Investigation incomplete</option>
                      <option value="KnownFailure">
                        Recorded known failure (server verifies)
                      </option>
                      {detail.job.state === "Isolated" && (
                        <option value="ConfirmedNotApplied">
                          Investigated: effects not applied
                        </option>
                      )}
                      <option value="AcceptDuplicateRisk">
                        Investigated: accept duplicate risk
                      </option>
                    </select>
                  </Field>
                  {(investigation === "ConfirmedNotApplied" ||
                    investigation === "AcceptDuplicateRisk") && (
                    <Field label="Investigation reason">
                      <textarea
                        value={investigationReason}
                        maxLength={512}
                        onChange={(event) => setInvestigationReason(event.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="I confirm possible duplicate effects">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                  </Field>
                </>
              )}
              {action === "corrected-redrive" && (
                <>
                  <Field label="Validated synthetic replacement JSON">
                    <textarea
                      {...stylex.props(styles.editor)}
                      value={editor}
                      onChange={(event) => setEditor(event.target.value)}
                      spellCheck={false}
                    />
                  </Field>
                  <div role="status">
                    {correction?.valid
                      ? "Schema valid"
                      : `Validation: ${correction?.rule ?? "schema-invalid"}`}
                  </div>
                  {correction?.valid &&
                    (correction.changes === null ? (
                      <p>Source diff unavailable</p>
                    ) : (
                      <ul {...stylex.props(styles.changes)}>
                        {correction.changes.map((change) => (
                          <li key={change.path}>
                            {change.kind}: {change.path}
                          </li>
                        ))}
                      </ul>
                    ))}
                </>
              )}
              {action === "manual-close" &&
                detail.problem?.outcomeKnowledge === "Unknown" && (
                  <Field label="I acknowledge unresolved external effects">
                    <input
                      type="checkbox"
                      checked={unknownConfirmed}
                      onChange={(event) => setUnknownConfirmed(event.target.checked)}
                    />
                  </Field>
                )}
              <div {...stylex.props(styles.actions)}>
                <Dialog.Close render={<Button />}>Keep current problem</Dialog.Close>
                <Button type="submit" disabled={disabled} variant="primary">
                  {resolving ? "Record resolution" : "Submit repair"}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
