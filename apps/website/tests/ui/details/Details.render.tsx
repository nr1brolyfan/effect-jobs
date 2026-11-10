/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
// Isolated frozen-contract fixture; NOT a shared runtime DTO or API response.
import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { useEffect, useLayoutEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Effect, Schema, Scope } from "effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import { JobId } from "effect-jobs/JobId"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobDetailsDrawer } from "../../../src/features/jobs/details/JobDetailsDrawer.js"
import { JobDetailsPage } from "../../../src/features/jobs/details/JobDetailsPage.js"
import * as Navigation from "../../../src/features/jobs/details/Navigation.js"
import { Button, Panel } from "../../../src/ui/Primitives.js"

const registry = AtomRegistry.make()
const scope = Scope.makeUnsafe()
const selected = Atom.make<JobId | null>(null).pipe(Atom.keepAlive)
const restored = Atom.make<Navigation.JobReturnContext | null>(null).pipe(Atom.keepAlive)
const notice = Atom.make("").pipe(Atom.keepAlive)
const mode = location.pathname.startsWith("/demo") ? "demo" : "private"
const source = Schema.decodeSync(JobId)("synthetic-source")
const successor = Schema.decodeSync(JobId)("synthetic-successor")
let pendingRestore = false
const nav = Effect.runSync(
  Navigation.make(registry, window, {
    mode,
    sandbox: () => Fixtures.sandbox.ref,
    capture: () => ({
      sandbox: Fixtures.sandbox.ref,
      filters: { state: "Dead", kind: "synthetic.kind" },
      view: "jobs",
      pageSize: 20,
      pageNumber: 3,
      cursors: [undefined, "fixture-2", "fixture-3"],
      scrollY: window.scrollY,
      selectedJobId: source
    }),
    relock: () => registry.set(selected, null),
    restore: (saved, explanation) => {
      registry.set(restored, saved)
      registry.set(notice, explanation)
      pendingRestore = true
    }
  }).pipe(Scope.provide(scope))
)

function detail(jobId: JobId): JobDetail {
  const job = {
    ...Fixtures.detail.job,
    jobId,
    state: "Dead" as const,
    attemptsMade: 2,
    stalledCount: 1,
    completedAt: Fixtures.detail.job.updatedAt
  }
  return {
    ...Fixtures.detail,
    job,
    createdAt: null,
    result: { _tag: "Unavailable" as const, reason: "not-stored" as const },
    payload: { _tag: "Unavailable" as const, reason: "not-stored" as const },
    provider: {
      source: "synthetic-postgresql" as const,
      accepted: false,
      invocations: 4,
      observedAt: null
    },
    lineage: {
      originalSourceJobId: source,
      sourceJobId: null,
      kind: "CorrectedRedrive" as const
    },
    problem: {
      rootJobId: source,
      state: "InProgress" as const,
      version: 1,
      updatedAt: job.updatedAt,
      activeSuccessorJobId: successor,
      outcomeKnowledge: "Unknown" as const,
      resolution: null
    },
    history: {
      coverage: "RetainedFacts" as const,
      attempts: null,
      items: [
        { _tag: "Snapshot" as const, job, observedAt: job.updatedAt },
        {
          _tag: "Operator" as const,
          requestId: "synthetic-request",
          action: "corrected-redrive",
          sourceJobId: source,
          resultJobId: successor,
          observedAt: job.updatedAt
        },
        {
          _tag: "Resolution" as const,
          rootJobId: source,
          state: "InProgress",
          kind: "OperatorReconciled",
          reason: "Synthetic operator reason",
          observedAt: job.updatedAt
        }
      ],
      nextCursor: null
    },
    related: {
      items: [
        {
          jobId: successor,
          state: "Completed" as const,
          kind: "CorrectedRedrive" as const,
          sourceAvailable: false
        },
        { jobId: source, state: null, kind: null, sourceAvailable: false }
      ],
      nextCursor: null
    },
    eligibility: {
      redrive: { enabled: false, reason: "investigation-required" },
      correctedRedrive: { enabled: false, reason: "investigation-required" }
    }
  }
}

function VolatilePayload() {
  const [unlocked, setUnlocked] = useState(false)
  useEffect(
    () => () => {
      document.documentElement.dataset.slotUnmounts = String(
        Number(document.documentElement.dataset.slotUnmounts ?? 0) + 1
      )
    },
    []
  )
  return (
    <Panel aria-label="Synthetic payload slot">
      <h2>Payload</h2>
      <Button onClick={() => setUnlocked(!unlocked)}>Toggle synthetic unlock</Button>
      {unlocked ? <p>UNLOCKED SYNTHETIC SENTINEL</p> : <p>Locked synthetic payload</p>}
    </Panel>
  )
}

function Fixture() {
  const route = useAtomValue(nav.route)
  const chosen = useAtomValue(selected)
  const saved = useAtomValue(restored)
  const explanation = useAtomValue(notice)
  useLayoutEffect(() => {
    if (route._tag === "List" && pendingRestore) {
      pendingRestore = false
      Navigation.restoreViewport(saved, document, window)
    }
    if (route._tag === "Detail") {
      document.querySelector<HTMLElement>("[data-job-details-heading]")?.focus()
    }
  }, [route, saved])
  const jobId = route._tag === "Detail" ? route.jobId : chosen
  const props =
    jobId === null
      ? null
      : {
          detail: detail(jobId),
          now: Fixtures.detail.job.updatedAt,
          onClose: () =>
            route._tag === "Detail" ? nav.close() : registry.set(selected, null),
          onOpenFull: () => nav.openFull(jobId),
          onRelated: nav.related,
          payloadSlot: <VolatilePayload />,
          repairSlot: (
            <Panel aria-label="Repair slot">
              <h2>Repair</h2>
              <p>Server eligibility required.</p>
            </Panel>
          )
        }
  if (route._tag === "Stale" || route._tag === "Invalid") {
    return (
      <main>
        <h1>Details unavailable</h1>
        <p>Stale or invalid expected generation.</p>
        <Button onClick={nav.close}>Back to jobs</Button>
      </main>
    )
  }
  if (route._tag === "Detail" && props) {
    return <JobDetailsPage {...props} />
  }
  return (
    <main>
      <h1>Jobs fixture</h1>
      <Button data-jobs-focus-fallback="">Jobs list</Button>
      <p role="status">{explanation}</p>
      <p id="return-context">
        {saved
          ? `Page ${saved.pageNumber}; ${saved.filters.state}; ${saved.filters.name}; ${saved.cursors[2]}`
          : "Page 3; Dead; synthetic.kind"}
      </p>
      <div style={{ height: 700 }} aria-hidden="true" />
      <Button data-job-id={source} onClick={() => registry.set(selected, source)}>
        Inspect synthetic source
      </Button>
      {props && <JobDetailsDrawer {...props} />}
    </main>
  )
}
const root = document.getElementById("fixture")!
createRoot(root).render(
  <RegistryContext.Provider value={registry}>
    <Fixture />
  </RegistryContext.Provider>
)
