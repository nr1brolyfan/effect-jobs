import { Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { CatalogIdentity, ProducerIdentity } from "effect-jobs/JobIdentity"
import { Counter, JobState } from "effect-jobs/JobLifecycle"
import { EpochMillis, PersistedJobPolicy } from "effect-jobs/JobPolicy"
import { FailureCode } from "effect-jobs/JobFailure"
import {
  JsonValue,
  JobProblem,
  JobRepairReason,
  JobResolutionState,
  Reason
} from "./Repairs.js"
import { RequestId } from "./Scenarios.js"
import { SandboxRef } from "./Sandbox.js"

export const Cursor = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024))
)
export type Cursor = typeof Cursor.Type
export const JobFilters = Schema.Struct({
  state: Schema.optional(JobState),
  kind: Schema.optional(CatalogIdentity.fields.kind),
  resolution: Schema.optional(JobResolutionState),
  needsAttention: Schema.optional(Schema.Literal(true))
})
export type JobFilters = typeof JobFilters.Type
export const ListJobs = Schema.Struct({
  sandbox: SandboxRef,
  filters: JobFilters,
  cursor: Schema.optional(Cursor),
  limit: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))
})
export type ListJobs = typeof ListJobs.Type
// Explicit allowlist. No payload, ciphertext, fingerprint, lease token, user data or raw errors.
export const JobSummary = Schema.Struct({
  jobId: JobId,
  catalog: CatalogIdentity,
  state: JobState,
  availableAt: EpochMillis,
  updatedAt: EpochMillis,
  completedAt: Schema.NullOr(EpochMillis),
  attemptsMade: Counter,
  stalledCount: Counter,
  lifecycleVersion: Counter,
  lastFailureCode: Schema.NullOr(FailureCode)
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (job) =>
        (job.state === "Completed" ||
          job.state === "Dead" ||
          job.state === "Cancelled") ===
        (job.completedAt !== null)
    )
  )
)
export type JobSummary = typeof JobSummary.Type
export const JobStats = Schema.Struct({
  total: Counter,
  Pending: Counter,
  RetryScheduled: Counter,
  Active: Counter,
  Completed: Counter,
  Dead: Counter,
  Cancelled: Counter,
  Isolated: Counter
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (stats) =>
        stats.total ===
        stats.Pending +
          stats.RetryScheduled +
          stats.Active +
          stats.Completed +
          stats.Dead +
          stats.Isolated +
          stats.Cancelled
    )
  )
)
export type JobStats = typeof JobStats.Type
export const JobAttentionStats = Schema.Struct({
  Open: Counter,
  InProgress: Counter,
  Resolved: Counter,
  needsAttention: Counter
}).pipe(
  Schema.check(Schema.makeFilter((s) => s.needsAttention === s.Open + s.InProgress))
)
export type JobAttentionStats = typeof JobAttentionStats.Type
export const JobPage = Schema.Struct({
  sandbox: SandboxRef,
  items: Schema.Array(JobSummary).pipe(Schema.check(Schema.isMaxLength(50))),
  nextCursor: Schema.NullOr(Cursor),
  // Matching rows before the cursor predicate, from the same scoped SQL snapshot.
  filteredTotal: Counter,
  stats: JobStats,
  attentionStats: JobAttentionStats
})
export type JobPage = typeof JobPage.Type
export const JobDetailRequest = Schema.Struct({ sandbox: SandboxRef, jobId: JobId })
export type JobDetailRequest = typeof JobDetailRequest.Type
// Relations belong to the application, never generic jobs storage.
export const ApplicationRelations = Schema.Struct({
  syntheticOrderId: Schema.optional(Schema.Literals(["demo-order-a", "demo-order-b"])),
  syntheticActor: Schema.optional(Schema.Literal("demo-customer")),
  syntheticTenant: Schema.optional(Schema.Literals(["demo-tenant-a", "demo-tenant-b"]))
})
export const Observation = Schema.Struct({
  source: Schema.Literals(["mock", "local", "workerd", "hosted"]),
  observedAt: EpochMillis,
  outcome: Schema.Literals(["success", "retry", "dead", "isolated", "unknown"])
})
export const JobRedriveKind = Schema.Literals(["Redrive", "CorrectedRedrive"])
export type JobRedriveKind = typeof JobRedriveKind.Type
export const JobLineage = Schema.Struct({
  originalSourceJobId: JobId,
  sourceJobId: Schema.NullOr(JobId),
  kind: JobRedriveKind
})
export type JobLineage = typeof JobLineage.Type
export const JobPayloadView = Schema.Union([
  Schema.TaggedStruct("Available", {
    formatVersion: Schema.Literal(1),
    catalog: CatalogIdentity,
    encoded: JsonValue,
    validation: Schema.Literal("Valid"),
    encryption: Schema.Literals(["None", "PrivateDocumentV1", "SyntheticDocumentV1"])
  }),
  Schema.TaggedStruct("Unavailable", {
    reason: Schema.Literals(["not-stored", "invalid-artifact", "unsupported-catalog"])
  })
])
export type JobPayloadView = typeof JobPayloadView.Type
export const JobHistoryItem = Schema.Union([
  Schema.TaggedStruct("Snapshot", { job: JobSummary, observedAt: EpochMillis }),
  Schema.TaggedStruct("Operator", {
    requestId: RequestId,
    action: Schema.Literals(["retry-now", "cancel", "redrive", "corrected-redrive"]),
    sourceJobId: JobId,
    resultJobId: JobId,
    observedAt: EpochMillis
  }),
  Schema.TaggedStruct("Resolution", {
    rootJobId: JobId,
    state: JobResolutionState,
    kind: Schema.Literals([
      "SuccessorCompleted",
      "OperatorReconciled",
      "ManualClose",
      "Reopened"
    ]),
    reason: Schema.NullOr(Reason),
    observedAt: EpochMillis
  })
])
export type JobHistoryItem = typeof JobHistoryItem.Type
export const JobHistory = Schema.Struct({
  coverage: Schema.Literal("RetainedFacts"),
  attempts: Schema.Null,
  items: Schema.Array(JobHistoryItem).pipe(Schema.check(Schema.isMaxLength(50))),
  nextCursor: Schema.NullOr(Cursor)
})
export type JobHistory = typeof JobHistory.Type
export const JobRelatedItem = Schema.Struct({
  jobId: JobId,
  state: Schema.NullOr(JobState),
  kind: Schema.NullOr(JobRedriveKind),
  sourceAvailable: Schema.Boolean
})
export type JobRelatedItem = typeof JobRelatedItem.Type
export const JobRelatedPage = Schema.Struct({
  items: Schema.Array(JobRelatedItem).pipe(Schema.check(Schema.isMaxLength(50))),
  nextCursor: Schema.NullOr(Cursor)
})
export type JobRelatedPage = typeof JobRelatedPage.Type
export const JobDetailPageRequest = Schema.Struct({
  sandbox: SandboxRef,
  jobId: JobId,
  cursor: Schema.optional(Cursor),
  limit: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))
})
export type JobDetailPageRequest = typeof JobDetailPageRequest.Type
export const JobProblemRow = Schema.Struct({
  problem: JobProblem,
  representative: Schema.NullOr(JobSummary)
})
export type JobProblemRow = typeof JobProblemRow.Type
export const JobProblemPage = Schema.Struct({
  sandbox: SandboxRef,
  items: Schema.Array(JobProblemRow).pipe(Schema.check(Schema.isMaxLength(50))),
  nextCursor: Schema.NullOr(Cursor),
  filteredTotal: Counter,
  stats: JobStats,
  attentionStats: JobAttentionStats
})
export type JobProblemPage = typeof JobProblemPage.Type
const repairEligibility = Schema.Struct({
  enabled: Schema.Boolean,
  reason: Schema.NullOr(JobRepairReason)
})
export const JobDetail = Schema.Struct({
  sandbox: SandboxRef,
  job: JobSummary,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  relations: ApplicationRelations,
  observation: Schema.optional(Observation),
  createdAt: Schema.Null,
  payload: JobPayloadView,
  result: Schema.TaggedStruct("Unavailable", { reason: Schema.Literal("not-stored") }),
  history: JobHistory,
  provider: Schema.NullOr(
    Schema.Struct({
      source: Schema.Literal("synthetic-postgresql"),
      accepted: Schema.Boolean,
      invocations: Counter,
      observedAt: Schema.Null
    })
  ),
  lineage: Schema.NullOr(JobLineage),
  problem: Schema.NullOr(JobProblem),
  related: JobRelatedPage,
  eligibility: Schema.Struct({
    redrive: repairEligibility,
    correctedRedrive: repairEligibility
  })
})
export type JobDetail = typeof JobDetail.Type
