import { Schema } from "effect"
import { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobProblem } from "@effect-jobs/playground-contracts/Repairs"
import * as Policy from "effect-jobs/JobPolicy"
import * as Catalogs from "@effect-jobs/playground-contracts/ScenarioCatalogs"
import { JobId } from "effect-jobs/JobId"
// Browser-only synthetic repair data; no Worker implementation or backend imports.
const ref = Schema.decodeSync(SandboxRef)({ sandboxId: "repair-test", generation: 1 })
const sourceId = Schema.decodeSync(JobId)("repair-source")
const successorId = Schema.decodeSync(JobId)("repair-successor")
const payload = {
  sandbox: ref,
  version: 1,
  seed: 0,
  sequence: 1,
  behavior: "dead",
  actor: "demo-customer",
  tenant: "demo-tenant-a",
  order: "demo-order-a"
}
const problem = Schema.decodeUnknownSync(JobProblem)({
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
    catalog: Catalogs.WelcomeEmail.catalog,
    state: "Dead",
    availableAt: 100,
    updatedAt: 900,
    completedAt: 900,
    finalizedAttempts: 2,
    stalledCount: 0,
    lifecycleVersion: 2,
    lastFailureCode: "fake_provider_terminal_rejected"
  },
  producer: {
    operation: "playground.synthetic",
    operationId: "test",
    slot: "welcome-email"
  },
  policy: Policy.defaultPolicy,
  relations: { syntheticActor: payload.actor, syntheticOrderId: payload.order },
  createdAt: null,
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: Catalogs.WelcomeEmail.catalog,
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
