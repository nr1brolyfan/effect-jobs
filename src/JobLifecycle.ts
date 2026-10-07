import { define as defineFailureCodes } from "./FailureCode.js"
/**
 * Pure lifecycle transition plans; backends own atomic fencing and database-time writes.
 */
import { Data, Result, Schema } from "effect"
import { JobId } from "./JobId.js"
import { FailureCode, JobFailure } from "./JobFailure.js"
import { EpochMillis, PersistedJobPolicy, maximumMillis } from "./JobPolicy.js"

/**
 * Nonnegative safe integer Schema for durable counters, not a policy limit.
 *
 * @category schemas
 */
export const Counter = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
)
/**
 * Bounded lease token Schema: 1–128 hexadecimal/hyphen characters.
 *
 * @category schemas
 */
export const LeaseToken = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[0-9a-f-]+$/iu)
  )
)
/**
 * Bounded backend recovery/cleanup batch Schema: integer 1–500.
 *
 * @category schemas
 */
export const BatchLimit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
)
/**
 * Durable states; OutcomeUnknown is an attempt outcome rather than a state.
 *
 * @category schemas
 */
export const JobState = Schema.Literals([
  "Pending",
  "Active",
  "RetryScheduled",
  "Completed",
  "Dead",
  "Isolated"
])
/**
 * Exact job/token/expiry/version fencing identity; handlers do not receive it.
 *
 * @category schemas
 */
export const JobOwnership = Schema.Struct({
  jobId: JobId,
  leaseToken: LeaseToken,
  leaseExpiresAt: EpochMillis,
  lifecycleVersion: Counter
})
/**
 * Decoded value of the JobOwnership Schema.
 *
 * @category models
 */
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
/** Decoded complete lifecycle metadata; does not include or validate the payload. */
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
/** Confirmable durable transitions; OutcomeUnknown is deliberately absent. */
export type JobFinalization = typeof JobFinalization.Type
/**
 * Tagged constructors and matchers for durable finalization commands.
 *
 * @category constructors
 */
export const JobFinalizations = Data.taggedEnum<JobFinalization>()

/**
 * Bounded validation, arithmetic, eligibility or ownership failure for a pure plan.
 *
 * @category errors
 */
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
/**
 * Validates complete lifecycle metadata and cross-field invariants, returning
 * Result rather than raw Schema diagnostics; does not validate payload artifacts.
 *
 * @category operations
 */
export const validateSnapshot = (
  row: unknown
): Result.Result<JobSnapshot, JobLifecycleError> =>
  Result.mapError(decodeSnapshot(row), () => invalid("invalid-snapshot"))

/**
 * Adds positive bounded milliseconds without overflow/clamping. Adapters supply
 * one DB-time snapshot for the entire atomic transition; reads no process clock.
 *
 * @category operations
 */
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
/**
 * Checks exact Active job/token/version/expiry and leaseExpiresAt > dbNow.
 * A lease at the expiry millisecond is no longer owned.
 *
 * @category operations
 */
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

/**
 * Checks remaining lease >= attempt timeout + positive operation response budget.
 *
 * @category operations
 */
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

/**
 * One-based attemptsMade + 1; may repeat after unknown outcomes and recovery.
 * Not an invocation count or external idempotency key.
 *
 * @category operations
 */
export const attemptNumber = (row: JobSnapshot): number => row.attemptsMade + 1

/**
 * Plans a due Pending/RetryScheduled claim (availableAt <= dbNow) with a fixed lease.
 * Does not increment attempts; the backend must lock/CAS and commit atomically.
 *
 * @category operations
 */
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

/**
 * Extracts fencing identity from an Active snapshot; otherwise returns ownership-lost.
 *
 * @category operations
 */
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

/**
 * Plans release only before execution and while the exact lease remains owned.
 * Clears ownership without incrementing attempts; backend commits the plan atomically.
 *
 * @category operations
 */
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

/**
 * Plans one fenced Complete/Retry/Dead/Isolate transition and increments attempts once.
 * Uses first stored fixed delay; next availability >= notAfter or exhausted attempts
 * becomes Dead. notAfter limits retry scheduling, not handler execution.
 *
 * @category operations
 */
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

/**
 * Plans recovery at leaseExpiresAt <= dbNow. Increments stalls, not attempts;
 * exceeding maxStalledCount makes the job Dead. Backend owns bounded atomic recovery.
 *
 * @category operations
 */
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
      lastFailureCode: dead ? internalCodes.stall_limit_exceeded : null,
      leaseToken: null,
      leaseExpiresAt: null
    }
  })

/**
 * Maps only validated explicit failure values; OutcomeUnknown returns null, leaving
 * no confirmed transition. Cause/defect/interruption classification belongs to the worker.
 *
 * @category operations
 */
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

/**
 * Pure terminal-retention eligibility at expiry <= dbNow. Pending, Active,
 * RetryScheduled and Isolated are excluded. Application/backend must coordinate
 * domain references and deletion atomically; this result is not deletion authority.
 *
 * @category operations
 */
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

const internalCodes = defineFailureCodes({ stall_limit_exceeded: "stall_limit_exceeded" })
