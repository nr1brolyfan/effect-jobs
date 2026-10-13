// Browser-test FFI: synthetic reads exercise the actual Dashboard/Runtime wiring.
// No HTTP/PG fixture qualification, credentials, or mutations are claimed here.
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { JobDetailsDrawer } from "../../../src/features/jobs/details/JobDetailsDrawer.js"
import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as FixtureClient from "../../../src/features/jobs/FixtureClient.js"
import * as Mount from "../../../src/features/jobs/Mount.js"

let releases: Array<() => void> = []
let hold = true
const mountDashboard = () => {
  const mounted = Mount.mount(
    document.getElementById("fixture")!,
    {
      ...FixtureClient.client,
      detail: (request) =>
        Effect.promise(
          () =>
            new Promise<typeof Fixtures.detail>((resolve) => {
              const release = () =>
                resolve({
                  ...Fixtures.detail,
                  job: FixtureClient.page.items.find(
                    (job) => job.jobId === request.jobId
                  )!
                })
              if (hold) {
                releases.push(release)
              } else {
                release()
              }
            })
        )
    },
    { ...Fixtures.sandbox, expiresAt: Date.now() + 600_000 },
    { demo: true, poll: false }
  )
  const focusEvents: Array<{ tag: string; jobId: string | null; text: string | null }> =
    []
  document.addEventListener("focusin", (event) => {
    const target = event.target
    if (target instanceof HTMLElement) {
      focusEvents.push({
        tag: target.tagName,
        jobId: target.getAttribute("data-job-id"),
        text: target.textContent?.slice(0, 100) ?? null
      })
    }
  })
  Object.assign(window, {
    focusFixture: {
      pending: () => releases.length,
      release: () => {
        hold = false
        const pending = releases
        releases = []
        for (const release of pending) {
          release()
        }
      },
      refresh: () => mounted.runtime.run(mounted.runtime.refresh),
      events: () => focusEvents,
      dispose: mounted.dispose
    }
  })
}

function IsolatedDrawer() {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState(true)
  const [snapshot, setSnapshot] = useState(Fixtures.detail)
  useEffect(() => {
    Object.assign(window, {
      focusFixture: {
        replace: () => setRevision((value) => value + 1),
        remove: () => setVisible(false),
        refresh: () => setSnapshot({ ...Fixtures.detail }),
        dispose: () => setOpen(false)
      }
    })
  }, [])
  return (
    <main>
      <button data-jobs-focus-fallback="">Jobs list</button>
      {visible && (
        <button
          key={revision}
          data-job-id={Fixtures.detail.job.jobId}
          onClick={() => setOpen(true)}
        >
          Inspect synthetic job
        </button>
      )}
      {open && (
        <JobDetailsDrawer
          detail={snapshot}
          now={Fixtures.detail.job.updatedAt}
          onClose={() => setOpen(false)}
          onOpenFull={() => setOpen(false)}
          onRelated={() => setOpen(false)}
          payloadSlot={<VolatileSlot />}
          repairSlot={null}
        />
      )}
    </main>
  )
}
function VolatileSlot() {
  const [unlocked, setUnlocked] = useState(false)
  useEffect(
    () => () => {
      document.documentElement.dataset.closedSlot = "true"
    },
    []
  )
  return (
    <button onClick={() => setUnlocked(!unlocked)}>
      {unlocked ? "Synthetic unlocked" : "Synthetic locked"}
    </button>
  )
}
if (location.pathname === "/isolated") {
  createRoot(document.getElementById("fixture")!).render(<IsolatedDrawer />)
} else {
  mountDashboard()
}
