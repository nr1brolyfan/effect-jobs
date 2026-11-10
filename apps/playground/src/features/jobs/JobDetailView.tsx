/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import type { Runtime } from "./Runtime.js"
import { styles } from "./Dashboard.stylex.js"
import { useLayoutEffect, useRef } from "react"
import { Button } from "../../ui/Primitives.js"
import { JobDetailsDrawer } from "./details/JobDetailsDrawer.js"
import { JobDetailsPage } from "./details/JobDetailsPage.js"
import { SyntheticDocumentSession } from "./payload/SyntheticDocumentSession.js"
import { JobPayloadPanel } from "./payload/JobPayloadPanel.js"
import { JobRepairPanel } from "./repair/JobRepairPanel.js"
import * as OperatorEligibility from "./OperatorEligibility.js"
import { OperatorControls } from "./OperatorControls.js"
export const JobDetailView = (props: {
  readonly runtime: Runtime
  readonly demo: boolean
  readonly full?: boolean
  readonly close: () => void
}) => {
  const detailState = useAtomValue(props.runtime.views.detail)
  const commands = useAtomValue(props.runtime.views.commands)
  const sandbox = useAtomValue(props.runtime.atoms.sandbox)
  const route = useAtomValue(props.runtime.navigation.route)
  const now = useAtomValue(props.runtime.now)
  const state = { ...detailState, ...commands, sandbox }
  const close = props.close
  const unavailable =
    state.busy || state.pending !== undefined || sandbox.expiresAt <= now
  const fullDetailFocus = useRef<{ identity: string; focused: boolean } | undefined>(
    undefined
  )
  useLayoutEffect(() => {
    if (route._tag !== "Detail") {
      fullDetailFocus.current = undefined
      return
    }
    const identity = JSON.stringify([
      route.mode,
      state.sandbox.ref.sandboxId,
      route.generation,
      route.jobId
    ])
    if (fullDetailFocus.current?.identity !== identity) {
      fullDetailFocus.current = { identity, focused: false }
    }
    const detail = state.detail
    if (
      fullDetailFocus.current.focused ||
      state.sandbox.expiresAt <= now ||
      route.generation !== state.sandbox.ref.generation ||
      state.selected !== route.jobId ||
      state.detailError !== undefined ||
      detail?.job.jobId !== route.jobId ||
      detail.sandbox.sandboxId !== state.sandbox.ref.sandboxId ||
      detail.sandbox.generation !== route.generation
    ) {
      return
    }
    const heading = document.querySelector<HTMLElement>("[data-job-details-heading]")
    if (heading) {
      heading.focus({ preventScroll: true })
      fullDetailFocus.current.focused = true
    }
  }, [route, state.selected, state.detail, state.detailError, state.sandbox, now])
  const detail = state.detail
  const identity = `${props.demo ? "demo" : "private"}:${state.sandbox.ref.sandboxId}:${state.sandbox.ref.generation}:${detail?.job.jobId}`
  const repairActions = detail
    ? OperatorEligibility.repairApplicability(detail, props.demo)
    : undefined
  const operatorActions = detail
    ? OperatorEligibility.eligibility(detail, state.sandbox, now)
    : undefined
  const hasActions =
    repairActions &&
    (repairActions.redrive ||
      repairActions.correct ||
      repairActions.resolve ||
      operatorActions?.retryNow.enabled ||
      operatorActions?.cancel.enabled)
  const detailProps = detail
    ? {
        detail,
        now,
        onClose: close,
        onOpenFull: () => props.runtime.navigation.openFull(detail.job.jobId),
        onRelated: (jobId: typeof detail.job.jobId) =>
          props.runtime.navigation.openFull(jobId),
        payloadSlot: (
          <JobPayloadPanel
            key={identity}
            detail={detail}
            identityKey={identity}
            allowCopyEncoded={!props.demo}
          />
        ),
        repairSlot:
          hasActions || state.pending || state.notice ? (
            <div {...stylex.props(styles.detailActions)}>
              <OperatorControls
                runtime={props.runtime}
                detail={detail}
                sandbox={state.sandbox}
                now={now}
                blocked={unavailable}
              />
              <JobRepairPanel
                key={identity}
                detail={detail}
                readOnly={props.demo}
                blocked={
                  state.busy ||
                  (state.pending !== undefined && state.pending.kind !== "repair") ||
                  state.sandbox.expiresAt <= now
                }
                pending={state.pending?.kind === "repair" ? state.pending.command : null}
                onSubmit={(command) =>
                  void props.runtime.run(props.runtime.repair(command))
                }
                onReceipt={() => void props.runtime.run(props.runtime.receipt)}
                onResolve={(command) =>
                  void props.runtime.run(props.runtime.repair(command))
                }
              />
              {state.notice && <p role="status">{state.notice}</p>}
              {state.pending && state.pending.kind !== "repair" && (
                <Button
                  disabled={state.busy}
                  onClick={() => void props.runtime.run(props.runtime.receipt)}
                >
                  Check exact {state.pending.kind} receipt
                </Button>
              )}
            </div>
          ) : null
      }
    : undefined
  if (props.full) {
    return (
      <main>
        {route._tag === "Detail" && detailProps && state.sandbox.expiresAt > now ? (
          <SyntheticDocumentSession
            key={JSON.stringify([identity, "page", detail?.payload])}
          >
            <JobDetailsPage {...detailProps} />
          </SyntheticDocumentSession>
        ) : (
          <>
            <p role="status">
              {route._tag === "Stale"
                ? "Stale generation. Return to this mode's list."
                : route._tag === "Invalid"
                  ? "Invalid job link."
                  : state.detailError
                    ? `Detail unavailable: ${state.detailError}.`
                    : "Loading job details…"}
            </p>
            <Button onClick={close}>Back to jobs</Button>
          </>
        )}
        {state.pending && (
          <Button
            disabled={state.busy}
            onClick={() => void props.runtime.run(props.runtime.receipt)}
          >
            Check exact request receipt
          </Button>
        )}
      </main>
    )
  }

  return detailProps && state.sandbox.expiresAt > now ? (
    <SyntheticDocumentSession key={JSON.stringify([identity, "drawer", detail?.payload])}>
      <JobDetailsDrawer {...detailProps} />
    </SyntheticDocumentSession>
  ) : null
}
