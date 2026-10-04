/**
 * @title Visible code, wrappers, naming, and modules
 */
import { Effect, Match, Schedule, Schema } from "effect"
import {
  RegistrationStore,
  RegistrationUnavailable,
  type RegistrationInput
} from "../fixtures/Auth.js"

declare const input: RegistrationInput

export const visible = Effect.gen(function* () {
  const store = yield* RegistrationStore

  // Keep ownership changes visible at the call site.
  return yield* store
    .create(input)
    .pipe(Effect.mapError(() => new RegistrationUnavailable({})))
})

class ProviderReadUnavailable extends Schema.TaggedError<ProviderReadUnavailable>()(
  "ProviderReadUnavailable",
  { reason: Schema.Literals(["denied", "timeout", "transient"]) }
) {}

const readRetry = Schedule.recurs(2).pipe(
  Schedule.setInputType<ProviderReadUnavailable>(),
  Schedule.while(({ input }) =>
    Match.value(input).pipe(
      Match.when({ reason: "timeout" }, () => true),
      Match.when({ reason: "transient" }, () => true),
      Match.when({ reason: "denied" }, () => false),
      Match.exhaustive
    )
  )
)

// Good wrapper: many idempotent provider reads require this exact, verbose policy.
// It takes only the wrapped Effect and appears directly in pipe at the call site.
// Do not apply a retry wrapper like this to mutations without an idempotency contract.
const withReadOnlyProviderPolicy = <A, R>(
  effect: Effect.Effect<A, ProviderReadUnavailable, R>
) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: "2 seconds",
      orElse: () => Effect.fail(new ProviderReadUnavailable({ reason: "timeout" }))
    }),
    Effect.retry(readRetry)
  )

declare const loadIdentityProfile: Effect.Effect<string, ProviderReadUnavailable>

export const identityProfile = loadIdentityProfile.pipe(withReadOnlyProviderPolicy)

/*
// Avoid: aliases hide one obvious constructor.
const unavailable = () => new RegistrationUnavailable({})
effect.pipe(Effect.mapError(unavailable))

// Avoid: forwarding wrappers add no semantics to a trusted Effect service.
const createStore = Effect.fnUntraced(function* (input: RegistrationInput) {
  return yield* store.create(input)
})

// Avoid: broad objects make large operation boundaries hard to scan.
const service: RegistrationService = {
  create: Effect.fn("Registration.create")(function* (input) {
    // hundreds of lines
  })
}
*/

// Preferred module ownership:
// Registration.ts            contract, domain values, errors
// RegistrationLayer.ts       substantial technology-independent orchestration
// PostgreSqlRegistration.ts  concrete adapter with make/layer
//
// Use PascalCase filenames and Effect primitives. Use *Layer, not *Live. Avoid
// facade-only modules, folder barrels, and static imports from tags to adapters.
