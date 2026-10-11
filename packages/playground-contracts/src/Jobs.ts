import { Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { CatalogIdentity, ProducerIdentity } from "effect-jobs/JobIdentity"
import { Counter, JobState } from "effect-jobs/JobLifecycle"
import { EpochMillis, PersistedJobPolicy } from "effect-jobs/JobPolicy"
import { FailureCode } from "effect-jobs/JobFailure"
import { SandboxRef } from "./Sandbox.js"

export const Cursor = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024))
)
export type Cursor = typeof Cursor.Type
export const JobFilters = Schema.Struct({
  state: Schema.optional(JobState),
  kind: Schema.optional(CatalogIdentity.fields.kind)
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
        (job.state === "Completed" || job.state === "Dead") === (job.completedAt !== null)
    )
  )
)
export type JobSummary = typeof JobSummary.Type
export const JobPage = Schema.Struct({
  sandbox: SandboxRef,
  items: Schema.Array(JobSummary).pipe(Schema.check(Schema.isMaxLength(50))),
  nextCursor: Schema.NullOr(Cursor)
})
export type JobPage = typeof JobPage.Type
export const JobDetailRequest = Schema.Struct({ sandbox: SandboxRef, jobId: JobId })
export type JobDetailRequest = typeof JobDetailRequest.Type
// Relations belong to the application, never generic jobs storage.
export const ApplicationRelations = Schema.Struct({
  syntheticOrderId: Schema.optional(Schema.Literals(["demo-order-a", "demo-order-b"])),
  syntheticActor: Schema.optional(Schema.Literal("demo-customer"))
})
export const Observation = Schema.Struct({
  source: Schema.Literals(["mock", "local", "workerd", "hosted"]),
  observedAt: EpochMillis,
  outcome: Schema.Literals(["success", "retry", "dead", "isolated", "unknown"])
})
export const JobDetail = Schema.Struct({
  sandbox: SandboxRef,
  job: JobSummary,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  relations: ApplicationRelations,
  observation: Schema.optional(Observation)
})
export type JobDetail = typeof JobDetail.Type
