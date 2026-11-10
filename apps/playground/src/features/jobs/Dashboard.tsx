/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { DashboardLayout } from "./DashboardLayout.js"
import { JobsOverview } from "./JobsOverview.js"
import { JobsList } from "./JobsList.js"
import { JobDetailView } from "./JobDetailView.js"
import { ProblemResolution } from "./ProblemResolution.js"
import { SessionStatus } from "./SessionStatus.js"
import { ScenarioLauncher } from "./ScenarioLauncher.js"

export const Dashboard = (props: {
  readonly runtime: Runtime
  readonly demo: boolean
}) => {
  const route = useAtomValue(props.runtime.navigation.route)
  const selected = useAtomValue(props.runtime.atoms.selected)
  const scenariosPanel = useRef<HTMLDetailsElement>(null)
  const scenarioControl = useRef<HTMLSelectElement>(null)
  const focusedSelection = useRef<string | undefined>(undefined)
  const close = () => {
    if (route._tag === "List") {
      props.runtime.closeDetail()
    } else {
      props.runtime.navigation.close()
    }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.runtime.snapshot().selected !== undefined) {
        close()
      }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [props.runtime, route])
  useLayoutEffect(() => {
    const previous = focusedSelection.current
    if (selected === undefined && previous !== undefined && route._tag === "List") {
      const target = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button[data-job-id]")
      ).find((button) => button.dataset.jobId === previous)
      ;(
        target ?? document.querySelector<HTMLElement>("[data-jobs-focus-fallback]")
      )?.focus({ preventScroll: true })
    }
    focusedSelection.current = selected
  }, [selected, route])
  if (route._tag !== "List") {
    return <JobDetailView {...props} full close={close} />
  }
  return (
    <DashboardLayout
      demo={props.demo}
      scenariosPanel={scenariosPanel}
      scenarioControl={scenarioControl}
    >
      <JobsOverview runtime={props.runtime} />
      <div {...classes(`jobs-layout${selected === undefined ? "" : " has-detail"}`)}>
        <JobsList runtime={props.runtime} />
        <JobDetailView {...props} close={close} />
      </div>
      <ProblemResolution runtime={props.runtime} />
      <SessionStatus {...props} />
      {!props.demo && (
        <ScenarioLauncher
          runtime={props.runtime}
          panel={scenariosPanel}
          control={scenarioControl}
        />
      )}
    </DashboardLayout>
  )
}
