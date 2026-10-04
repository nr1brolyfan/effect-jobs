/**
 * @title Effect tests and review checks
 */
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import {
  CreatedRegistration,
  Registration,
  RegistrationConflict,
  RegistrationStore,
  UserId,
  type RegistrationService,
  type RegistrationStoreService
} from "../fixtures/Auth.js"
import * as RegistrationStandard from "../01_services/10_services-and-layers.js"

const userId = Schema.decodeSync(UserId)("01890f47-3e2d-7a6b-8c4d-5e6f708192a4")

const RegistrationStoreTestLayer = Layer.succeed(
  RegistrationStore,
  RegistrationStore.of({
    create: () => Effect.fail(new RegistrationConflict())
  } satisfies RegistrationStoreService)
)

export const RegistrationTestLayer = RegistrationStandard.layerNoDeps({
  maximumUsernameLength: 100
}).pipe(Layer.provide(RegistrationStoreTestLayer))

export const RegistrationSuccessTestLayer = Layer.succeed(
  Registration,
  Registration.of({
    create: () =>
      Effect.succeed({
        operationId: "operation-1",
        userId
      } satisfies CreatedRegistration)
  } satisfies RegistrationService)
)

class RecordStore extends Context.Service<
  RecordStore,
  {
    readonly read: (key: string) => Effect.Effect<string>
    readonly write: (key: string, value: string) => Effect.Effect<void>
  }
>()("effect-auth/ai-docs/RecordStore") {}

// For a large service, mock only the operations exercised by this test.
// Unimplemented Effect methods fail loudly if called; non-Effect fields still
// need explicit values. Do not attach test mocks as statics to library tags.
export const RecordStoreReadTestLayer = Layer.mock(RecordStore, {
  read: (key) => Effect.succeed(key)
})

declare const operation: Effect.Effect<CreatedRegistration, RegistrationConflict>

export const assertConflict = operation.pipe(
  Effect.exit,
  Effect.map(
    Exit.match({
      onFailure: Cause.hasFails,
      onSuccess: () => false
    })
  )
)

// Clock-dependent operations stay deterministic without sleeping in real time.
export const advanceSessionClock = TestClock.adjust("24 hours")

// REVIEW: Is the failure classified before sanitization removes needed detail?
// REVIEW: Can telemetry contain a secret, identifier, provider message, or stack?
// REVIEW: Can a mixed Cause lose a defect or interruption here?
// REVIEW: Is the dependency yielded from Context instead of passed in options?
// REVIEW: Does a wrapper add semantics, or only hide one Effect/error/object?
// REVIEW: Is untrusted input and adapter output decoded before use?
// REVIEW: Do cleanup tests cover success, failure, defect, and interruption?
// REVIEW: Does mutation code preserve truthful commit knowledge?
