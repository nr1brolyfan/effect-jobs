import "../../../playground/src/styles/Jobs.css"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as FixtureClient from "../../../playground/tests/fixtures/FixtureClient.js"
import * as Mount from "../../../playground/src/features/jobs/Mount.js"

const root = document.getElementById("jobs")
if (root !== null) {
  const mounted = Mount.mount(
    root,
    FixtureClient.client,
    { ...Fixtures.sandbox, expiresAt: Date.now() + 600_000 },
    { poll: false }
  )
  window.addEventListener("pagehide", () => void mounted.dispose(), { once: true })
}
