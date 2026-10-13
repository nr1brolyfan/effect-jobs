import { Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import * as Policy from "effect-jobs/JobPolicy"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import { JobRepairCommand, JobProblem } from "@effect-jobs/playground-contracts/Repairs"
import * as Definitions from "../../src/scenarios/Definitions.js"

// Explicit synthetic test shapes, no lifecycle qualification or stored history.
export const ref = Schema.decodeSync(SandboxRef)({
  sandboxId: "repair-test",
  generation: 1
})
export const sourceId = Schema.decodeSync(JobId)("repair-source")
export const successorId = Schema.decodeSync(JobId)("repair-successor")
export const payload: Definitions.Payload = {
  sandbox: ref,
  version: 1,
  seed: 0,
  sequence: 1,
  behavior: "dead",
  actor: "demo-customer",
  tenant: "demo-tenant-a",
  order: "demo-order-a"
}
export const command = Schema.decodeUnknownSync(JobRepairCommand)({
  sandbox: ref,
  requestId: "repair-request",
  jobId: sourceId,
  expectedState: "Dead",
  expectedLifecycleVersion: 2,
  expectedResolutionVersion: 0,
  reason: "Change synthetic behavior",
  confirmDuplicateEffects: true,
  investigation: { _tag: "KnownFailure" },
  action: "corrected-redrive",
  payload: { ...payload, behavior: "success" }
})
export const problem = Schema.decodeUnknownSync(JobProblem)({
  rootJobId: sourceId,
  state: "InProgress",
  version: 1,
  updatedAt: 1000,
  activeSuccessorJobId: successorId,
  outcomeKnowledge: "KnownFailure",
  resolution: null
})
export const detail = Schema.decodeUnknownSync(JobDetail)({
  sandbox: ref,
  job: {
    jobId: sourceId,
    catalog: Definitions.WelcomeEmail.catalog,
    state: "Dead",
    availableAt: 100,
    updatedAt: 900,
    completedAt: 900,
    attemptsMade: 2,
    stalledCount: 0,
    lifecycleVersion: 2,
    lastFailureCode: "fake_provider_terminal_rejected"
  },
  producer: {
    operation: "playground.synthetic",
    operationId: "test",
    slot: "welcome-email"
  },
  policy: Policy.make(),
  relations: { syntheticActor: payload.actor, syntheticOrderId: payload.order },
  createdAt: null,
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: Definitions.WelcomeEmail.catalog,
    encoded: payload,
    validation: "Valid",
    encryption: "None"
  },
  result: { _tag: "Unavailable", reason: "not-stored" },
  history: { coverage: "RetainedFacts", attempts: null, items: [], nextCursor: null },
  provider: null,
  lineage: null,
  problem: {
    ...problem,
    state: "Open",
    version: 0,
    updatedAt: 900,
    activeSuccessorJobId: null
  },
  related: { items: [], nextCursor: null },
  eligibility: {
    redrive: { enabled: true, reason: null },
    correctedRedrive: { enabled: true, reason: null }
  }
})
export const sourceRow = {
  id: sourceId,
  queue: detail.job.catalog.queue,
  kind: detail.job.catalog.kind,
  version: 1,
  state: "Dead",
  available_at: 100,
  updated_at: 900,
  completed_at: 900,
  lifecycle_version: 2,
  attempts_made: 2,
  stalled_count: 0,
  lease_token: null,
  lease_expires_at: null,
  policy: detail.policy,
  last_failure_code: "fake_provider_terminal_rejected",
  accepted: false,
  invocations: 2,
  relations: {
    syntheticActor: payload.actor,
    syntheticOrderId: payload.order,
    syntheticTenant: payload.tenant
  }
}
