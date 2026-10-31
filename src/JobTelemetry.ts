import type { HealthSample } from "./internal/postgresql/Health.js"
import { Cause, Clock, Effect, Exit, Metric, Schema } from "effect"
import { JobFailure } from "./JobFailure.js"

export type Operation =
  | "claim"
  | "release"
  | "execute"
  | "invoke"
  | "attempt"
  | "finalize"
  | "recover-expired"
  | "polling"
  | "backoff"
  | "drain"
  | "enqueue"
  | "enqueue-standalone"
  | "cleanup"
  | "permit-wait"
  | "health"
export type Phase =
  | "dispatch"
  | "handler"
  | "finalization"
  | "reconciliation"
  | "protocol"
  | "maintenance"
  | "provisional"
  | "committed"
export type Outcome =
  | "success"
  | "failure"
  | "interrupted"
  | "unknown"
  | "timeout"
  | "retry"
  | "dead"
  | "isolate"

const resultTags = [
  "Unknown",
  "Unresolved",
  "Backoff",
  "Empty",
  "Claimed",
  "Owned",
  "InsufficientLease",
  "NotOwned",
  "Applied",
  "StillOwned",
  "OwnershipLost",
  "Inserted",
  "AlreadyPresent",
  "Idle",
  "MoreWork",
  "Complete",
  "Retry",
  "Dead",
  "Isolate",
  "InvalidOwnership",
  "Unsupported",
  "Abandoned"
] as const
const resultOf = (value: unknown): string => {
  if (typeof value === "object" && value !== null && "_tag" in value) {
    for (const tag of resultTags) {
      if (value._tag === tag) {
        return tag
      }
    }
  }
  return "none"
}

const UnknownCommit = Schema.Struct({
  _tag: Schema.Literals(["PostgreSqlFailure", "JobBackendError"]),
  commitKnowledge: Schema.Literal("Unknown")
})

export const classify = <A, E>(exit: Exit.Exit<A, E>): Outcome => {
  if (Exit.isSuccess(exit)) {
    const result = resultOf(exit.value)
    if (result === "Retry") {
      return "retry"
    }
    if (result === "Dead") {
      return "dead"
    }
    if (result === "Isolate") {
      return "isolate"
    }
    if (
      result === "InvalidOwnership" ||
      result === "Unsupported" ||
      result === "Abandoned"
    ) {
      return "unknown"
    }
    return result === "Unknown" || result === "Unresolved"
      ? "unknown"
      : result === "Backoff"
        ? "failure"
        : "success"
  }
  const reasons = exit.cause.reasons
  if (Cause.hasInterruptsOnly(exit.cause)) {
    return "interrupted"
  }
  const [reason] = reasons
  if (reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)) {
    if (reason.error instanceof Cause.TimeoutError) {
      return "timeout"
    }
    if (Schema.is(UnknownCommit)(reason.error)) {
      return "unknown"
    }
    if (Schema.is(JobFailure)(reason.error)) {
      switch (reason.error._tag) {
        case "Retry":
          return "retry"
        case "Dead":
          return "dead"
        case "Isolate":
          return "isolate"
        case "OutcomeUnknown":
          return "unknown"
      }
    }
  }
  return "failure"
}

const total = Metric.counter("effect_jobs_operation_total", { incremental: true })
const duration = Metric.histogram("effect_jobs_operation_duration_millis", {
  boundaries: [1, 10, 100, 1000, 10_000, 60_000],
  attributes: { unit: "ms" }
})
const inFlight = Metric.counter("effect_jobs_execution_in_flight", { incremental: false })
const transitions = Metric.counter("effect_jobs_transition_total", { incremental: true })
const maintained = Metric.counter("effect_jobs_maintenance_rows_total", {
  incremental: true
})

// Ambient request attributes are deliberately excluded at each update, without
// changing the caller's context. Deployment identity belongs in OTLP resources.
const isolated = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(Metric.CurrentMetricAttributes, {}))

/** Count only acknowledged native transitions, using the adapter's actual plan. */
export const confirmedTransition = (
  state: "Completed" | "RetryScheduled" | "Dead" | "Isolated"
) =>
  isolated(Metric.update(Metric.withAttributes(transitions, { "jobs.state": state }), 1))

/** One balanced process-local measurement around an entered execution. */
export const trackExecution = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    isolated(Metric.update(inFlight, 1)),
    () => effect,
    () => isolated(Metric.update(inFlight, -1))
  )

/** Bounded vocabulary only. Never pass values/Causes to a span or log sink. */
export const observe =
  (operation: Operation, phase: Phase) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        let exit!: Exit.Exit<A, E>
        yield* Effect.gen(function* () {
          const started = yield* Clock.currentTimeNanos
          exit = yield* Effect.exit(restore(effect))
          const ended = yield* Clock.currentTimeNanos
          const reasons = Exit.isFailure(exit) ? exit.cause.reasons : []
          const kinds = new Set(
            reasons.map((reason) =>
              Cause.isFailReason(reason)
                ? "failure"
                : Cause.isDieReason(reason)
                  ? "defect"
                  : "interrupted"
            )
          )
          const outcome = classify(exit)
          const fields = {
            "jobs.operation": operation,
            "jobs.phase": phase,
            "jobs.outcome": outcome,
            "jobs.result": Exit.isSuccess(exit) ? resultOf(exit.value) : "none",
            ...(reasons.length === 0
              ? {}
              : {
                  "jobs.cause_kind": kinds.size > 1 ? "mixed" : [...kinds][0]!,
                  "jobs.reason_count_bucket":
                    reasons.length === 1 ? "1" : reasons.length === 2 ? "2" : "3+"
                })
          }
          yield* Effect.annotateCurrentSpan(fields)
          yield* isolated(Metric.update(Metric.withAttributes(total, fields), 1))
          yield* isolated(
            Metric.update(
              Metric.withAttributes(duration, fields),
              Math.max(0, Number(ended - started) / 1e6)
            )
          )
          if (
            (operation === "cleanup" || operation === "recover-expired") &&
            Exit.isSuccess(exit) &&
            typeof exit.value === "number"
          ) {
            yield* isolated(
              Metric.update(
                Metric.withAttributes(maintained, { "jobs.operation": operation }),
                exit.value
              )
            )
          }
          const degraded =
            outcome === "failure" ||
            outcome === "unknown" ||
            outcome === "timeout" ||
            outcome === "isolate" ||
            outcome === "dead"
          yield* (
            degraded
              ? Effect.logWarning("effect-jobs operation completed")
              : Effect.logDebug("effect-jobs operation completed")
          ).pipe(Effect.annotateLogs(fields))
          // End our own span with void, restore the exact original Exit outside it.
        }).pipe(Effect.withSpan(`effect-jobs.${operation}`))
        return exit
      })
    ).pipe(Effect.flatMap((exit) => exit))

const healthDepth = Metric.gauge("effect_jobs_health_rows")
const healthAge = Metric.gauge("effect_jobs_health_oldest_age_seconds", {
  attributes: { unit: "s" }
})
const healthSaturated = Metric.gauge("effect_jobs_health_saturated")
const healthTime = Metric.gauge("effect_jobs_health_sample_time_seconds", {
  attributes: { unit: "s" }
})
/** Explicit reporter only. Never install once per worker sharing the same queue. */
export const recordHealth = (sample: HealthSample) =>
  Effect.gen(function* () {
    for (const kind of ["supported", "unsupported", "expired", "cleanup"] as const) {
      const bucket = sample[kind]
      const labels = { "jobs.backlog": kind }
      yield* isolated(
        Metric.update(
          Metric.withAttributes(healthSaturated, labels),
          bucket.saturated ? 1 : 0
        )
      )
      yield* isolated(
        Metric.update(Metric.withAttributes(healthDepth, labels), bucket.count)
      )
      // A missing oldest row is represented by -1; absent/stale never becomes zero age.
      yield* isolated(
        Metric.update(
          Metric.withAttributes(healthAge, labels),
          bucket.oldestAt === null
            ? -1
            : Math.max(0, sample.sampledAt - bucket.oldestAt) / 1000
        )
      )
    }
    yield* isolated(Metric.update(healthTime, sample.sampledAt / 1000))
  })

const lag = Metric.histogram("effect_jobs_scheduling_lag_millis", {
  boundaries: [1, 100, 1000, 10_000, 60_000, 300_000],
  attributes: { unit: "ms" }
})
/** Uses the validated claim's DB-time updatedAt sample, never a process clock. */
export const schedulingLag = (claimedAt: number, availableAt: number) =>
  isolated(Metric.update(lag, Math.max(0, claimedAt - availableAt)))
