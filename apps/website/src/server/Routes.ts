// Inert shared route mapping; commands and receipts use POST bodies.
export const routes = Object.freeze({
  sandboxIssue: "/api/sandbox/issue",
  sandbox: "/api/sandbox",
  jobs: "/api/jobs",
  problems: "/api/jobs/problems",
  history: "/api/jobs/history",
  related: "/api/jobs/related",
  repair: "/api/jobs/repair",
  repairReceipt: "/api/jobs/repair/receipt",
  resolution: "/api/jobs/resolution",
  resolutionReceipt: "/api/jobs/resolution/receipt",
  jobDetail: "/api/jobs/detail",
  operator: "/api/jobs/operator",
  operatorReceipt: "/api/jobs/operator/receipt",
  scenarios: "/api/scenarios",
  scenarioReceipt: "/api/scenarios/receipt",
  reset: "/api/sandbox/reset",
  resetReceipt: "/api/sandbox/reset/receipt",
  changes: "/api/changes"
})
