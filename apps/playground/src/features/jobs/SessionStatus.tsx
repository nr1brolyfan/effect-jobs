/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { Button, Icon } from "../../ui/Primitives.js"
import { DateTime } from "../../ui/DateTime.js"
export const SessionStatus = (props: {
  readonly runtime: Runtime
  readonly demo: boolean
}) => {
  const status = useAtomValue(props.runtime.views.status)
  const sandbox = useAtomValue(props.runtime.atoms.sandbox)
  const loading = useAtomValue(props.runtime.atoms.loading)
  const pending = useAtomValue(props.runtime.atoms.pending)
  const state = { ...status, sandbox, loading, pending }
  return (
    <div {...classes("session-bar")}>
      <p
        role="status"
        {...classes("connection-status")}
        data-connection={state.connection}
      >
        {state.connection}
        {state.error ? ` · ${state.error}` : ""}
        {state.connection === "stale"
          ? " · Last successful data retained; it may be outdated."
          : ""}
      </p>
      <p {...classes("sandbox-scope")}>
        {props.demo ? "Public demo" : "Own sandbox"}: {state.sandbox.ref.sandboxId} ·
        generation {state.sandbox.ref.generation} · expires{" "}
        <DateTime value={state.sandbox.expiresAt} label="Session expires" />
      </p>
      <Button
        variant="ghost"
        aria-disabled={state.loading || undefined}
        onClick={() => {
          if (!props.runtime.snapshot().loading) {
            void props.runtime.run(props.runtime.refresh)
          }
        }}
      >
        <Icon name="refresh" />
        Refresh reads
      </Button>
      {state.error === "sandbox-expired" && (
        <Button disabled={state.pending !== undefined} onClick={() => location.reload()}>
          Recover session
        </Button>
      )}
    </div>
  )
}
