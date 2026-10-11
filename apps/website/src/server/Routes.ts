// Serial registrar: implementations enter through typed bindings, never dynamic paths.
export const routes = Object.freeze({
  sandbox: "/api/sandbox",
  jobs: "/api/jobs",
  jobDetail: "/api/jobs/:jobId",
  scenarios: "/api/scenarios",
  scenarioReceipt: "/api/scenarios/:requestId",
  reset: "/api/sandbox/reset",
  resetReceipt: "/api/sandbox/reset/:requestId",
  changes: "/api/changes"
})
