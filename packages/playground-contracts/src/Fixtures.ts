import { Schema } from "effect"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { JobDetail, JobPage } from "./Jobs.js"
import { SandboxView } from "./Sandbox.js"

export const sandbox = Schema.decodeUnknownSync(SandboxView)(
  {
    ref: { sandboxId: "demo-sandbox", generation: 1 },
    expiresAt: 1_800_003_600_000,
    capabilities: {
      runScenario: false,
      resetSandbox: false,
      retryJob: false,
      cancelJob: false,
      redriveJob: false
    }
  },
  { onExcessProperty: "error" }
)
export const page = Schema.decodeUnknownSync(JobPage)(
  {
    sandbox: sandbox.ref,
    nextCursor: null,
    filteredTotal: 1,
    attentionStats: { Open: 0, InProgress: 0, Resolved: 0, needsAttention: 0 },
    stats: {
      total: 1,
      Pending: 0,
      RetryScheduled: 0,
      Active: 0,
      Completed: 1,
      Dead: 0,
      Isolated: 0,
      Cancelled: 0
    },
    items: [
      {
        jobId: "demo-job-a",
        catalog: { queue: "playground", name: "playground.scenario", version: 1 },
        state: "Completed",
        availableAt: 1_800_000_000_000,
        updatedAt: 1_800_000_001_000,
        completedAt: 1_800_000_001_000,
        attemptsMade: 1,
        stalledCount: 0,
        lifecycleVersion: 2,
        lastFailureCode: null
      }
    ]
  },
  { onExcessProperty: "error" }
)
export const detail = Schema.decodeUnknownSync(JobDetail)(
  {
    sandbox: sandbox.ref,
    job: page.items[0],
    createdAt: null,
    payload: { _tag: "Unavailable", reason: "not-stored" },
    result: { _tag: "Unavailable", reason: "not-stored" },
    history: { coverage: "RetainedFacts", attempts: null, items: [], nextCursor: null },
    provider: null,
    lineage: null,
    problem: null,
    related: { items: [], nextCursor: null },
    eligibility: {
      redrive: { enabled: false, reason: "public-read-only" },
      correctedRedrive: { enabled: false, reason: "public-read-only" }
    },
    producer: {
      operation: "playground.scenario",
      operationId: "demo-request-a",
      slot: "execute"
    },
    policy: JobPolicy.make(),
    relations: { syntheticOrderId: "demo-order-a", syntheticActor: "demo-customer" },
    observation: { source: "mock", observedAt: 1_800_000_001_000, outcome: "success" }
  },
  { onExcessProperty: "error" }
)
