/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { styles, layout } from "./Dashboard.stylex.js"
import type { RefObject } from "react"
import { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { Button, Field, Icon } from "../../ui/Primitives.js"
import { useFormAtom } from "./FormAtoms.js"
export const ScenarioLauncher = (props: {
  readonly runtime: Runtime
  readonly panel: RefObject<HTMLDetailsElement | null>
  readonly control: RefObject<HTMLSelectElement | null>
}) => {
  const commands = useAtomValue(props.runtime.views.commands)
  const sandbox = useAtomValue(props.runtime.atoms.sandbox)
  const now = useAtomValue(props.runtime.now)
  const state = { ...commands, sandbox }
  const unavailable =
    state.busy || state.pending !== undefined || sandbox.expiresAt <= now
  const [scenario, setScenario] = useFormAtom<typeof ScenarioId.Type>("success")
  const [count, setCount] = useFormAtom(1)
  return (
    <details
      ref={props.panel}
      {...classes("scenario-panel")}
      role="region"
      aria-label="Scenario launcher"
    >
      <summary {...stylex.props(layout.summary)}>
        <div {...classes("scenario-summary-title")}>
          <Icon name="terminal" />
          <strong>Scenario lab</strong>
        </div>
        <Icon name="plus" />
      </summary>
      <div {...classes("scenario-body")}>
        <Field label="Fake provider behavior">
          <select
            ref={props.control}
            value={scenario}
            onChange={(event) =>
              setScenario(event.target.value as typeof ScenarioId.Type)
            }
          >
            {ScenarioId.literals.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jobs (1–10)">
          <input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(event) => setCount(event.target.valueAsNumber)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={
            unavailable ||
            !state.sandbox.capabilities.runScenario ||
            (state.sandbox.capacity?.mode === "bounded" &&
              (state.sandbox.capacity.retainedJobs + count > 100 ||
                state.sandbox.capacity.admittedCommands >= 200))
          }
          onClick={() =>
            void props.runtime.run(
              props.runtime.command("scenario", crypto.randomUUID(), scenario, count)
            )
          }
        >
          Run scenario
        </Button>
        <Button
          disabled={
            unavailable ||
            !state.sandbox.capabilities.resetSandbox ||
            (state.sandbox.capacity?.mode === "bounded" &&
              (state.sandbox.capacity.retainedJobs > 94 ||
                state.sandbox.capacity.admittedCommands > 198))
          }
          onClick={() => {
            if (
              window.confirm(
                "Start a new generation with 6 starter jobs? Old jobs and receipts remain. Running jobs are not cancelled."
              )
            ) {
              void props.runtime.run(
                props.runtime.command("reset", crypto.randomUUID(), "success", 1)
              )
            }
          }}
        >
          Reset my sandbox
        </Button>
        <Button
          disabled={state.pending === undefined || state.busy}
          onClick={() => void props.runtime.run(props.runtime.receipt)}
        >
          Check exact request receipt
        </Button>
        <p {...stylex.props(layout.paragraph)}>
          {state.pending
            ? `Pending ${state.pending.kind} request: ${state.pending.request.requestId}`
            : ""}
        </p>
        <p role="status" {...stylex.props(styles.notice)}>
          {state.notice}
        </p>
      </div>
    </details>
  )
}
