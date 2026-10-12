import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as FixtureClient from "./FixtureClient.js"
import * as Mount from "./Mount.js"

// Explicit fixture entry for local development only. Registrar must select a real
// transport client for the hosted /jobs page and deliver server-described sandbox.
const root = document.getElementById("jobs")
if (root !== null) {
  Mount.mount(root, FixtureClient.client, Fixtures.sandbox)
}
