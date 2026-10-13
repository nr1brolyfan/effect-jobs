import { useState } from "react"
import { createRoot } from "react-dom/client"
import { JobRepairPanel } from "../../../src/features/jobs/repair/JobRepairPanel.js"
import type {
  JobRepairCommand,
  JobResolutionCommand
} from "@effect-jobs/playground-contracts/Repairs"
import * as Fixture from "../../../../playground-worker/tests/repairs/Fixtures.js"

const commands: (JobRepairCommand | JobResolutionCommand)[] = []
let receipts = 0
function App() {
  const [detail, setDetail] = useState(Fixture.detail)
  const [readOnly, setReadOnly] = useState(false)
  const [pending, setPending] = useState<JobRepairCommand | null>(null)
  Object.assign(window, {
    repairFixture: {
      commands,
      receipts: () => receipts,
      reset: () => {
        setPending(null)
        setReadOnly(false)
        setDetail(Fixture.detail)
        commands.length = 0
        receipts = 0
      },
      revise: () =>
        setDetail((old) => ({
          ...old,
          job: { ...old.job, lifecycleVersion: old.job.lifecycleVersion + 1 }
        })),
      readonly: () => setReadOnly(true),
      uncertain: () =>
        setDetail((old) => ({
          ...old,
          problem: old.problem ? { ...old.problem, outcomeKnowledge: "Unknown" } : null
        })),
      encrypted: () =>
        setDetail((old) => ({
          ...old,
          payload:
            old.payload._tag === "Available"
              ? { ...old.payload, encryption: "PrivateDocumentV1" }
              : old.payload,
          eligibility: {
            ...old.eligibility,
            correctedRedrive: {
              enabled: false,
              reason: "encrypted-correction-unavailable"
            }
          }
        }))
    }
  })
  return (
    <JobRepairPanel
      detail={detail}
      readOnly={readOnly}
      pending={pending}
      onSubmit={(command) => {
        commands.push(command)
        setPending(command)
      }}
      onReceipt={() => {
        receipts++
      }}
      onResolve={(command) => {
        commands.push(command)
        setReadOnly(true)
      }}
    />
  )
}
createRoot(document.getElementById("fixture")!).render(<App />)
