/* oxlint-disable effecttsgo/unstable-api-usage -- Qualify the exact owner-selected Effect4 Atom integration. */
import "../../src/styles/Jobs.css"
import { StrictMode, Profiler, useRef } from "react"
import { createRoot } from "react-dom/client"
import { RegistryContext } from "@effect/atom-react"
import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Crypto from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import { useFormAtom } from "../../src/features/jobs/FormAtoms.js"
import {
  SyntheticDocumentSession,
  useSyntheticDocumentSession
} from "../../src/features/jobs/payload/SyntheticDocumentSession.js"
import { JobPayloadPanel } from "../../src/features/jobs/payload/JobPayloadPanel.js"
import { JobsList } from "../../src/features/jobs/JobsList.js"
import * as Runtime from "../../src/features/jobs/Runtime.js"
import * as FixtureClient from "../fixtures/FixtureClient.js"

const document: Crypto.Document = {
  subject: "demo-customer",
  tenant: "demo-tenant-a",
  note: "volatile-synthetic-ui-secret"
}
const envelope = await Effect.runPromise(Crypto.sealSyntheticDocument(document))
const detail = {
  ...Fixtures.detail,
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: Crypto.syntheticDocumentCatalog,
    encoded: { sandboxId: "fixture-sandbox", behavior: "success", document: envelope },
    validation: "Valid",
    encryption: "SyntheticDocumentV1"
  }
} as JobDetail

let staleWrite: ((value: string) => void) | undefined
let listCommits = 0
const runtime = Runtime.make(
  FixtureClient.client,
  { ...Fixtures.sandbox, expiresAt: Date.now() + 60000 },
  { poll: false }
)
await runtime.run(runtime.refresh)
declare global {
  interface Window {
    uiProof: {
      commits: () => number
      tick: () => void
      notice: () => void
      dispose: () => Promise<void>
    }
  }
}
window.uiProof = {
  commits: () => listCommits,
  tick: () => runtime.registry.set(runtime.now, runtime.registry.get(runtime.now) + 1000),
  notice: () => runtime.registry.set(runtime.atoms.notice, "Unrelated receipt notice"),
  dispose: runtime.dispose
}
createRoot(window.document.getElementById("list")!).render(
  <RegistryContext.Provider value={runtime.registry}>
    <Profiler
      id="jobs-list"
      onRender={() => {
        listCommits++
      }}
    >
      <JobsList runtime={runtime} />
    </Profiler>
  </RegistryContext.Provider>
)
const SessionProbe = () => {
  const session = useSyntheticDocumentSession()
  return (
    <output aria-label="Session document">{session?.document?.note ?? "locked"}</output>
  )
}
const Field = (props: { readonly name: string }) => {
  const [value, setValue] = useFormAtom("")
  if (props.name === "First") {
    staleWrite = setValue
  }
  return (
    <label>
      {props.name}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  )
}
const Harness = () => {
  const [shown, setShown] = useFormAtom(true)
  const [generation, setGeneration] = useFormAtom(1)
  const stale = useRef<((value: string) => void) | undefined>(undefined)
  return (
    <>
      <h1>Scoped UI state qualification</h1>
      <button
        onClick={() => {
          stale.current = staleWrite
          setShown(false)
        }}
      >
        Close detail
      </button>
      <button onClick={() => setShown(true)}>Open detail</button>
      <button onClick={() => setGeneration(generation + 1)}>Change generation</button>
      <button onClick={() => stale.current?.("stale-write")}>
        Complete old callback
      </button>
      {shown && (
        <SyntheticDocumentSession key={generation}>
          <Field name="First" />
          <Field name="Second" />
          <SessionProbe />
          <JobPayloadPanel detail={detail} identityKey={`fixture:${generation}`} />
        </SyntheticDocumentSession>
      )}
    </>
  )
}

createRoot(window.document.getElementById("fixture")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
