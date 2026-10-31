import { Dialog } from "@base-ui/react/dialog"
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import { useRef, useState } from "react"
import { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { Button, Field, Icon } from "../../ui/Primitives.js"
import { styles } from "./CreateJobsDialog.stylex.js"
import type { Runtime } from "./Runtime.js"

export function CreateJobsDialog({ runtime }: { readonly runtime: Runtime }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const scenarioControl = useRef<HTMLSelectElement>(null)
  const state = useAtomValue(runtime.stateAtom)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button ref={trigger} variant="primary" />}>
        <Icon name="plus" />
        Create jobs
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          data-create-jobs-dialog
          {...stylex.props(styles.popup)}
          initialFocus={scenarioControl}
          finalFocus={trigger}
        >
          <header {...stylex.props(styles.header)}>
            <Dialog.Title {...stylex.props(styles.title)}>Create jobs</Dialog.Title>
            <Dialog.Close render={<Button />}>Close</Dialog.Close>
          </header>
          <Dialog.Description {...stylex.props(styles.description)}>
            Create synthetic jobs in your private sandbox.
          </Dialog.Description>
          {open && (
            <ScenarioControls
              key={JSON.stringify(state.sandbox.ref)}
              runtime={runtime}
              scenarioControl={scenarioControl}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ScenarioControls({
  runtime,
  scenarioControl
}: {
  readonly runtime: Runtime
  readonly scenarioControl: React.RefObject<HTMLSelectElement | null>
}) {
  const state = useAtomValue(runtime.stateAtom)
  const now = useAtomValue(runtime.now)
  const [scenario, setScenario] = useState<typeof ScenarioId.Type>("success")
  const [count, setCount] = useState(1)
  const unavailable =
    state.busy || state.pending !== undefined || state.sandbox.expiresAt <= now
  const validCount = Number.isInteger(count) && count >= 1 && count <= 10
  const capacity = state.sandbox.capacity
  const canCreate =
    !unavailable &&
    validCount &&
    state.sandbox.capabilities.runScenario &&
    !(
      capacity?.mode === "bounded" &&
      (capacity.retainedJobs + count > 100 || capacity.admittedCommands >= 200)
    )
  const canReset =
    !unavailable &&
    state.sandbox.capabilities.resetSandbox &&
    !(
      capacity?.mode === "bounded" &&
      (capacity.retainedJobs > 94 || capacity.admittedCommands > 198)
    )
  return (
    <div {...stylex.props(styles.content)}>
      <form
        {...stylex.props(styles.content)}
        onSubmit={(event) => {
          event.preventDefault()
          if (canCreate) {
            void runtime.run(
              runtime.command("scenario", crypto.randomUUID(), scenario, count)
            )
          }
        }}
      >
        <Field label="Fake provider behavior">
          <select
            ref={scenarioControl}
            value={scenario}
            disabled={unavailable}
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
            step={1}
            required
            value={Number.isNaN(count) ? "" : count}
            disabled={unavailable}
            onChange={(event) => setCount(event.target.valueAsNumber)}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={!canCreate}>
          {state.busy && state.pending?.kind === "scenario"
            ? "Creating…"
            : "Run scenario"}
        </Button>
      </form>
      <div role="status" {...stylex.props(styles.notice)}>
        {state.notice}
        {state.sandbox.expiresAt <= now && (
          <p>Session expired. Recover your session to create jobs.</p>
        )}
      </div>
      {state.pending && (
        <div {...stylex.props(styles.content)}>
          <p {...stylex.props(styles.notice)}>
            Pending {state.pending.kind} request: {state.pending.request.requestId}
          </p>
          <Button disabled={state.busy} onClick={() => void runtime.run(runtime.receipt)}>
            Check exact request receipt
          </Button>
        </div>
      )}
      <details {...stylex.props(styles.reset)}>
        <summary {...stylex.props(styles.summary)}>Reset sandbox</summary>
        <p {...stylex.props(styles.notice)}>
          Start a new generation with 6 starter jobs. Old jobs and receipts remain.
          Running jobs are not cancelled.
        </p>
        <Button
          disabled={!canReset}
          onClick={(event) => {
            if (
              canReset &&
              window.confirm(
                "Start a new generation with 6 starter jobs? Old jobs and receipts remain. Running jobs are not cancelled."
              )
            ) {
              // The acknowledged reset replaces generation-owned controls. Keep
              // keyboard focus on the stable dialog while that form is replaced.
              event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus({
                preventScroll: true
              })
              void runtime.run(
                runtime.command("reset", crypto.randomUUID(), "success", 1)
              )
            }
          }}
        >
          Reset my sandbox
        </Button>
      </details>
    </div>
  )
}
