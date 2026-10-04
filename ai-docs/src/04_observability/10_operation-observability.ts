/**
 * @title Observable operation boundary
 *
 * Classify locally, sanitize before export, then emit one terminal observation.
 */
import { Effect, Exit, Match, Metric, Schema } from "effect"
import {
  sanitizeEffectCause,
  singleFailure
} from "../../../src/server/internal/CauseSanitization.js"
import { inspectCause } from "../../../src/server/internal/AuthTelemetryVocabulary.js"
import {
  CreatedRegistration,
  RegistrationConflict,
  RegistrationInput,
  RegistrationStore,
  RegistrationUnavailable,
  type RegistrationFailure
} from "../fixtures/Auth.js"

const operationTotal = Metric.counter("effect_auth_operation_total", {
  incremental: true
})

class RegistrationDefect extends Schema.TaggedError<RegistrationDefect>()(
  "RegistrationDefect",
  {}
) {}

const sanitizeRegistrationCause = sanitizeEffectCause(
  Match.type<unknown>().pipe(
    Match.when(Match.instanceOf(RegistrationConflict), () => new RegistrationConflict()),
    Match.orElse(() => new RegistrationUnavailable({}))
  ),
  () => new RegistrationDefect()
)

const observeExit = Effect.fnUntraced(function* (
  exit: Exit.Exit<CreatedRegistration, RegistrationFailure>
) {
  return yield* Exit.match(exit, {
    onFailure: (cause) =>
      Effect.gen(function* () {
        const result = Match.value(singleFailure(cause)).pipe(
          Match.when(Match.instanceOf(RegistrationConflict), () => "conflict" as const),
          Match.orElse(() => "unavailable" as const)
        )
        const inspected = inspectCause(cause)

        yield* Effect.annotateCurrentSpan({
          "auth.operation": "registration",
          "auth.result": result,
          "auth.cause_kind": inspected.kind,
          "auth.cause_reason_count": inspected.reasonCount
        })
        yield* Metric.update(
          Metric.withAttributes(operationTotal, {
            operation: "registration",
            result
          }),
          1
        )
        yield* Effect.logInfo("effect-auth operation completed", {
          operation: "registration",
          result,
          causeKind: inspected.kind,
          reasonCount: inspected.reasonCount
        })
      }),
    onSuccess: () =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          "auth.operation": "registration",
          "auth.result": "created"
        })
        yield* Metric.update(
          Metric.withAttributes(operationTotal, {
            operation: "registration",
            result: "created"
          }),
          1
        )
        yield* Effect.logInfo("effect-auth operation completed", {
          operation: "registration",
          result: "created"
        })
      })
  })
})

export const create = Effect.fn("Registration.create")(
  function* (
    input: RegistrationInput
  ): Effect.fn.Return<CreatedRegistration, RegistrationFailure, RegistrationStore> {
    const store = yield* RegistrationStore
    return yield* store.create(input).pipe(
      Effect.tapCause((cause) => {
        const category = Match.value(singleFailure(cause)).pipe(
          Match.when(Match.instanceOf(RegistrationConflict), () => "conflict" as const),
          Match.when(
            Match.instanceOf(RegistrationUnavailable),
            () => "unavailable" as const
          ),
          Match.orElse(() => "unexpected" as const)
        )
        return Effect.annotateCurrentSpan({
          "auth.failure_phase": "persistence",
          "auth.failure_category": category
        })
      }),
      Effect.mapError(
        Match.type<RegistrationConflict | RegistrationUnavailable>().pipe(
          Match.when(
            Match.instanceOf(RegistrationConflict),
            () => new RegistrationConflict()
          ),
          Match.orElse(() => new RegistrationUnavailable({}))
        )
      ),
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(CreatedRegistration)(value, {
          onExcessProperty: "error"
        }).pipe(Effect.mapError(() => new RegistrationUnavailable({})))
      )
    )
  },
  sanitizeRegistrationCause,
  Effect.onExit(observeExit)
)

// Never attach raw identifiers, passwords, bearers, SQL, provider messages,
// stack traces, Causes, or arbitrary error objects to logs, metrics, or spans.
