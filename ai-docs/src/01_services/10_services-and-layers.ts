/**
 * @title Services and Layers
 *
 * Yield runtime dependencies from Context, keep operations named, and expose
 * the bare constructor Layer before supplying local defaults.
 */
import { Effect, Layer, Redacted, Schema } from "effect"
import {
  CreatedRegistration,
  Registration,
  RegistrationConfigurationError,
  RegistrationInput,
  RegistrationInputRejected,
  RegistrationStore,
  RegistrationUnavailable,
  type RegistrationService
} from "../fixtures/Auth.js"

export interface RegistrationLayerOptions {
  readonly maximumUsernameLength: number
}

export const make = (options: RegistrationLayerOptions) =>
  Effect.gen(function* () {
    const store = yield* RegistrationStore
    const maximumUsernameLength = yield* Schema.decodeEffect(
      Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 255 })))
    )(options.maximumUsernameLength).pipe(
      Effect.mapError(
        () =>
          new RegistrationConfigurationError({
            reason: "invalid-maximum-username-length"
          })
      )
    )

    const create = Effect.fn("Registration.create")(function* (input: RegistrationInput) {
      const decoded = yield* Schema.decodeEffect(RegistrationInput)(input, {
        onExcessProperty: "error"
      }).pipe(
        Effect.mapError(() => new RegistrationInputRejected({ reason: "malformed" }))
      )

      yield* Schema.decodeEffect(
        Schema.String.pipe(Schema.check(Schema.isMaxLength(maximumUsernameLength)))
      )(Redacted.value(decoded.username)).pipe(
        Effect.mapError(() => new RegistrationInputRejected({ reason: "malformed" }))
      )

      const created = yield* store.create(decoded)
      return yield* Schema.decodeUnknownEffect(CreatedRegistration)(created, {
        onExcessProperty: "error"
      }).pipe(Effect.mapError(() => new RegistrationUnavailable({})))
    })

    return Registration.of({ create } satisfies RegistrationService)
  })

// Produces Registration; requires RegistrationStore. No dependency Layers are
// supplied, so callers (especially tests) can choose their own store.
export const layerNoDeps = (options: RegistrationLayerOptions) =>
  Layer.effect(Registration, make(options))

// When a sensible implementation is owned here, expose a separate `layer`
// that provides it locally: layerNoDeps(options).pipe(Layer.provide(storeLayer)).
// `layer` still produces only Registration, not RegistrationStore. Keep shared
// or environment-specific dependencies explicit when no local default fits.

/*
// Avoid: runtime dependencies do not belong in configuration options.
make({ store, maximumUsernameLength: 100 })

// Avoid: do not redeclare a trusted Effect service or copy it into `dependencies`.
const createStore = Effect.fnUntraced(function* (input: RegistrationInput) {
  return yield* store.create(input)
})
*/
