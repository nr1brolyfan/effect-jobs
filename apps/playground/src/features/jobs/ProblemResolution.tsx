/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import type { Runtime } from "./Runtime.js"
import { Field } from "../../ui/Primitives.js"
export const ProblemResolution = (props: { readonly runtime: Runtime }) => {
  const query = useAtomValue(props.runtime.views.query)
  const list = useAtomValue(props.runtime.views.list)
  const state = { ...query, ...list }
  return (
    <section aria-label="Problem resolution">
      <p>
        Needs attention counts unresolved problem chains. Execution counts include every
        retained job.
      </p>
      <Field label="Resolution">
        <select
          value={
            state.filters.needsAttention
              ? "attention"
              : (state.filters.resolution ?? "all")
          }
          onChange={(event) => {
            const value = event.target.value
            void props.runtime.run(
              props.runtime.filter({
                ...state.filters,
                resolution:
                  value === "Open" || value === "InProgress" || value === "Resolved"
                    ? value
                    : undefined,
                needsAttention: value === "attention" ? true : undefined
              })
            )
          }}
        >
          <option value="all">All executions</option>
          <option value="attention">Needs attention</option>
          <option value="Open">Open</option>
          <option value="InProgress">In progress</option>
          <option value="Resolved">Resolved</option>
        </select>
      </Field>
      {state.problemRows
        ?.filter((row) => row.representative === null)
        .map((row) => (
          <p key={row.problem.rootJobId}>
            Job no longer retained: {row.problem.rootJobId} · {row.problem.state}
          </p>
        ))}
    </section>
  )
}
