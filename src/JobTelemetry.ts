import { Cause, Clock, Effect, Exit, Metric } from "effect"

export type Operation =
  | "claim"
  | "release"
  | "execute"
  | "finalize"
  | "recover-expired"
  | "polling"
  | "backoff"
export type Phase =
  | "dispatch"
  | "handler"
  | "finalization"
  | "reconciliation"
  | "protocol"
  | "maintenance"
export type Outcome = "success" | "failure" | "interrupted" | "unknown" | "timeout"

const successOutcome = (value: unknown): Outcome => {
  if (typeof value === "object" && value !== null && "_tag" in value) {
    if (value._tag === "Unknown" || value._tag === "Unresolved") {
      return "unknown"
    }
    if (value._tag === "Backoff") {
      return "failure"
    }
  }
  return "success"
}

const total = Metric.counter("effect_jobs_operation_total", { incremental: true })
const duration = Metric.histogram("effect_jobs_operation_duration_millis", {
  boundaries: [1, 10, 100, 1000, 10_000, 60_000]
})

/** Bounded vocabulary only. No arbitrary attributes, errors, codes or identities. */
export const observe =
  (operation: Operation, phase: Phase) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Allocate per execution, including concurrent runs of the same Effect.
        let exit!: Exit.Exit<A, E>
        yield* Effect.gen(function* () {
          const started = yield* Clock.currentTimeMillis
          exit = yield* Effect.exit(restore(effect))
          const ended = yield* Clock.currentTimeMillis
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
          const [reason] = reasons
          const outcome: Outcome = Exit.isSuccess(exit)
            ? successOutcome(exit.value)
            : reasons.length === 1 &&
                reason !== undefined &&
                Cause.isFailReason(reason) &&
                reason.error instanceof Cause.TimeoutError
              ? "timeout"
              : kinds.size === 1 && kinds.has("interrupted")
                ? "interrupted"
                : "failure"
          const fields = {
            "jobs.operation": operation,
            "jobs.phase": phase,
            "jobs.outcome": outcome,
            ...(reasons.length === 0
              ? {}
              : {
                  "jobs.cause_kind": kinds.size > 1 ? "mixed" : [...kinds][0]!,
                  "jobs.reason_count_bucket":
                    reasons.length === 1 ? "1" : reasons.length === 2 ? "2" : "3+"
                })
          }
          yield* Effect.annotateCurrentSpan(fields)
          yield* Metric.update(Metric.withAttributes(total, fields), 1)
          yield* Metric.update(
            Metric.withAttributes(duration, fields),
            Math.max(0, ended - started)
          )
          yield* Effect.logInfo("effect-jobs operation completed", fields)
          // Span completion must contain neither the operation value nor its Cause.
        }).pipe(Effect.withSpan(`effect-jobs.${operation}`))
        return exit
      })
    ).pipe(Effect.flatMap((exit) => exit))
