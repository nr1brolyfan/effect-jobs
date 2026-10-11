// Inert shared route mapping; commands and receipts use POST bodies.
export const routes = Object.freeze({
  sandboxIssue: "/api/sandbox/issue",
  sandbox: "/api/sandbox",
  jobs: "/api/jobs",
  jobDetail: "/api/jobs/detail",
  scenarios: "/api/scenarios",
  scenarioReceipt: "/api/scenarios/receipt",
  reset: "/api/sandbox/reset",
  resetReceipt: "/api/sandbox/reset/receipt",
  changes: "/api/changes"
})
