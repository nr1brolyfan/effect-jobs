import { Data, Result, Schema } from "effect"
import { JobId } from "./JobId.js"
import { FailureCode, JobFailure } from "./JobFailure.js"
import { EpochMillis, PersistedJobPolicy, maximumMillis } from "./JobPolicy.js"

/** Mechanical source bounds, not new execution-policy limits. */
export const Counter = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
)
export const LeaseToken = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[0-9a-f-]+$/iu)
  )
)
export const BatchLimit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
)
export const JobState = Schema.Literals([
  "Pending",
  "Active",
  "RetryScheduled",
  "Completed",
  "Dead",
  "Isolated"
])
export const JobOwnership = Schema.Struct({
  jobId: JobId,
  leaseToken: LeaseToken,
  leaseExpiresAt: EpochMillis,
  lifecycleVersion: Counter
})
export type JobOwnership = typeof JobOwnership.Type

const SnapshotStruct = Schema.Struct({
  jobId: JobId,
  policy: PersistedJobPolicy,
  state: JobState,
  availableAt: EpochMillis,
  updatedAt: EpochMillis,
  attemptsMade: Counter,
  stalledCount: Counter,
  lifecycleVersion: Counter,
  leaseToken: Schema.NullOr(LeaseToken),
  leaseExpiresAt: Schema.NullOr(EpochMillis),
  completedAt: Schema.NullOr(EpochMillis),
  lastFailureCode: Schema.NullOr(FailureCode)
})
/** Complete durable metadata. Payload validation belongs to the codec, not this Schema. */
export const JobSnapshot = SnapshotStruct.pipe(
  Schema.check(
    Schema.makeFilter(
      (row) =>
        row.attemptsMade <= row.policy.maxAttempts &&
        row.stalledCount <= row.policy.maxStalledCount + 1 &&
        (row.state === "Active"
          ? row.leaseToken !== null &&
            row.leaseExpiresAt !== null &&
            row.completedAt === null
          : row.leaseToken === null && row.leaseExpiresAt === null) &&
        (row.state === "Completed" || row.state === "Dead"
          ? row.completedAt !== null
          : row.completedAt === null) &&
        (!(
          row.state === "Pending" ||
          row.state === "RetryScheduled" ||
          row.state === "Active"
        ) ||
          (row.attemptsMade < row.policy.maxAttempts &&
            row.stalledCount <= row.policy.maxStalledCount))
    )
  )
)
export type JobSnapshot = typeof JobSnapshot.Type

/** Retry uses the first stored policy; callers cannot replace its schedule. */
export const JobFinalization = Schema.Union([
  Schema.TaggedStruct("Complete", {}),
  Schema.TaggedStruct("Retry", {
    code: FailureCode,
    notAfter: Schema.optional(EpochMillis)
  }),
  Schema.TaggedStruct("Dead", { code: FailureCode }),
  Schema.TaggedStruct("Isolate", { code: FailureCode })
])
export type JobFinalization = typeof JobFinalization.Type
export const JobFinalizations = Data.taggedEnum<JobFinalization>()

export class JobLifecycleError extends Data.TaggedError("JobLifecycleError")<{
  readonly reason:
    | "invalid-snapshot"
    | "invalid-command"
    | "arithmetic-bound"
    | "not-eligible"
    | "ownership-lost"
    | "execution-started"
}> {}
const invalid = (reason: JobLifecycleError["reason"]) => new JobLifecycleError({ reason })
const decodeSnapshot = Schema.decodeUnknownResult(JobSnapshot, {
  onExcessProperty: "error"
})
const decodeOwnership = Schema.decodeUnknownResult(JobOwnership, {
  onExcessProperty: "error"
})
const decodeFinalization = Schema.decodeUnknownResult(JobFinalization, {
  onExcessProperty: "error"
})
export const validateSnapshot = (
  row: unknown
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.mapError(decodeSnapshot(row), () => invalid("invalid-snapshot"))

/** No process clock: adapters supply one DB-time snapshot for the entire atomic write. */
export const addTimestamp = (
  dbNow: number,
  millis: number
): Result.Result<number, JobLifecycleError> =>
  Schema.is(EpochMillis)(dbNow) &&
  Schema.is(EpochMillis)(millis) &&
  millis <= maximumMillis - dbNow
    ? Result.succeed(dbNow + millis)
    : Result.fail(invalid("arithmetic-bound"))
const increment = (n: number): Result.Result<number, JobLifecycleError> =>
  n < Number.MAX_SAFE_INTEGER
    ? Result.succeed(n + 1)
    : Result.fail(invalid("arithmetic-bound"))
const validateTime = (dbNow: number): Result.Result<number, JobLifecycleError> =>
  Schema.is(EpochMillis)(dbNow)
    ? Result.succeed(dbNow)
    : Result.fail(invalid("invalid-command"))
export const isOwned = (
  row: JobSnapshot,
  ownership: JobOwnership,
  dbNow: number
): boolean =>
  row.state === "Active" &&
  row.jobId === ownership.jobId &&
  row.leaseToken === ownership.leaseToken &&
  row.lifecycleVersion === ownership.lifecycleVersion &&
  row.leaseExpiresAt === ownership.leaseExpiresAt &&
  ownership.leaseExpiresAt > dbNow

export const usableLease = (
  row: JobSnapshot,
  dbNow: number,
  operationResponseBudgetMillis: number
): boolean =>
  Schema.is(EpochMillis)(dbNow) &&
  Schema.is(EpochMillis)(operationResponseBudgetMillis) &&
  row.state === "Active" &&
  row.leaseExpiresAt !== null &&
  row.leaseExpiresAt - dbNow - row.policy.attemptTimeoutMillis >=
    operationResponseBudgetMillis

export const attemptNumber = (row: JobSnapshot): number => row.attemptsMade + 1

/** A plan is not a write. The backend must lock/CAS the input and commit the whole transition atomically. */
export const claim = (
  input: unknown,
  leaseToken: string,
  dbNow: number,
  operationResponseBudgetMillis: number
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.gen(function* () {
    const row = yield* validateSnapshot(input)
    yield* validateTime(dbNow)
    if (
      !Schema.is(LeaseToken)(leaseToken) ||
      !Schema.is(EpochMillis)(operationResponseBudgetMillis)
    ) {
      return yield* Result.fail(invalid("invalid-command"))
    }
    if (
      !(row.state === "Pending" || row.state === "RetryScheduled") ||
      row.availableAt > dbNow ||
      row.policy.leaseDurationMillis - row.policy.attemptTimeoutMillis <
        operationResponseBudgetMillis
    ) {
      return yield* Result.fail(invalid("not-eligible"))
    }
    const leaseExpiresAt = yield* addTimestamp(dbNow, row.policy.leaseDurationMillis)
    const lifecycleVersion = yield* increment(row.lifecycleVersion)
    return {
      ...row,
      state: "Active",
      leaseToken,
      leaseExpiresAt,
      lifecycleVersion,
      updatedAt: dbNow
    }
  })

export const ownershipOf = (
  row: JobSnapshot
): Result.Result<JobOwnership, JobLifecycleError> =>
  row.state === "Active" && row.leaseToken !== null && row.leaseExpiresAt !== null
    ? Result.succeed({
        jobId: row.jobId,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
        lifecycleVersion: row.lifecycleVersion
      })
    : Result.fail(invalid("ownership-lost"))

export const release = (
  input: unknown,
  expected: JobOwnership,
  dbNow: number,
  phase: "BeforeExecution" | "Executing"
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.gen(function* () {
    const row = yield* validateSnapshot(input)
    const ownership = yield* Result.mapError(decodeOwnership(expected), () =>
      invalid("invalid-command")
    )
    yield* validateTime(dbNow)
    if (phase !== "BeforeExecution") {
      return yield* Result.fail(invalid("execution-started"))
    }
    if (!isOwned(row, ownership, dbNow)) {
      return yield* Result.fail(invalid("ownership-lost"))
    }
    const lifecycleVersion = yield* increment(row.lifecycleVersion)
    return {
      ...row,
      state: "Pending",
      availableAt: dbNow,
      updatedAt: dbNow,
      lifecycleVersion,
      leaseToken: null,
      leaseExpiresAt: null
    }
  })

export const finalize = (
  input: unknown,
  expected: JobOwnership,
  command: JobFinalization,
  dbNow: number
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.gen(function* () {
    const row = yield* validateSnapshot(input)
    const ownership = yield* Result.mapError(decodeOwnership(expected), () =>
      invalid("invalid-command")
    )
    const finalization = yield* Result.mapError(decodeFinalization(command), () =>
      invalid("invalid-command")
    )
    yield* validateTime(dbNow)
    if (!isOwned(row, ownership, dbNow)) {
      return yield* Result.fail(invalid("ownership-lost"))
    }
    const lifecycleVersion = yield* increment(row.lifecycleVersion)
    const attemptsMade = yield* increment(row.attemptsMade)
    const nextAvailableAt =
      finalization._tag === "Retry"
        ? yield* addTimestamp(dbNow, row.policy.retrySchedule.delayMillis)
        : row.availableAt
    const state =
      finalization._tag === "Complete"
        ? "Completed"
        : finalization._tag === "Isolate"
          ? "Isolated"
          : finalization._tag === "Dead" ||
              attemptsMade >= row.policy.maxAttempts ||
              (finalization.notAfter !== undefined &&
                nextAvailableAt >= finalization.notAfter)
            ? "Dead"
            : "RetryScheduled"
    return {
      ...row,
      state,
      attemptsMade,
      lifecycleVersion,
      availableAt: nextAvailableAt,
      updatedAt: dbNow,
      completedAt: state === "Completed" || state === "Dead" ? dbNow : null,
      lastFailureCode: finalization._tag === "Complete" ? null : finalization.code,
      leaseToken: null,
      leaseExpiresAt: null
    }
  })

export const recoverExpired = (
  input: unknown,
  dbNow: number
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.gen(function* () {
    const row = yield* validateSnapshot(input)
    yield* validateTime(dbNow)
    if (
      row.state !== "Active" ||
      row.leaseExpiresAt === null ||
      row.leaseExpiresAt > dbNow
    ) {
      return yield* Result.fail(invalid("not-eligible"))
    }
    const stalledCount = yield* increment(row.stalledCount)
    const lifecycleVersion = yield* increment(row.lifecycleVersion)
    const dead = stalledCount > row.policy.maxStalledCount
    return {
      ...row,
      state: dead ? "Dead" : "Pending",
      stalledCount,
      lifecycleVersion,
      updatedAt: dbNow,
      completedAt: dead ? dbNow : null,
      lastFailureCode: dead ? "stall_limit_exceeded" : null,
      leaseToken: null,
      leaseExpiresAt: null
    }
  })

/** Only explicit validated single failures are known. Cause/defect/timeout classification is worker-owned. */
export const finalizationFromFailure = (
  input: unknown
): Result.Result<JobFinalization | null, JobLifecycleError> =>
  Result.map(
    Result.mapError(
      Schema.decodeUnknownResult(JobFailure, { onExcessProperty: "error" })(input),
      () => invalid("invalid-command")
    ),
    (failure) => (failure._tag === "OutcomeUnknown" ? null : failure)
  )

/** Pure eligibility only; domain reference coordination and atomic deletion remain app/backend obligations. */
export const cleanupEligible = (
  row: JobSnapshot,
  dbNow: number
): Result.Result<boolean, JobLifecycleError> =>
  Result.gen(function* () {
    const stored = yield* validateSnapshot(row)
    yield* validateTime(dbNow)
    if (
      (stored.state !== "Completed" && stored.state !== "Dead") ||
      stored.completedAt === null
    ) {
      return false
    }
    const retention =
      stored.state === "Completed"
        ? stored.policy.completedRetention
        : stored.policy.deadRetention
    if (retention._tag === "Forever") {
      return false
    }
    const expiresAt = yield* addTimestamp(stored.completedAt, retention.millis)
    return expiresAt <= dbNow
  })
