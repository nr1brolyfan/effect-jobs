import { Context, Data, Effect, Redacted, Schema } from "effect"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const RegistrationInput = Schema.Struct({
  username: Schema.Redacted(Schema.String),
  password: Schema.Redacted(Schema.String)
})
export type RegistrationInput = typeof RegistrationInput.Type

export const CreatedRegistration = Schema.Struct({
  operationId: Schema.String,
  userId: UserId
})
export type CreatedRegistration = typeof CreatedRegistration.Type

export const CommitKnowledge = Schema.Literals(["Committed", "NotCommitted", "Unknown"])
export type CommitKnowledge = typeof CommitKnowledge.Type

export class RegistrationInputRejected extends Schema.TaggedError<RegistrationInputRejected>()(
  "RegistrationInputRejected",
  { reason: Schema.Literal("malformed") }
) {}

export class RegistrationConfigurationError extends Schema.TaggedError<RegistrationConfigurationError>()(
  "RegistrationConfigurationError",
  { reason: Schema.Literal("invalid-maximum-username-length") }
) {}

export class RegistrationConflict extends Data.TaggedError("RegistrationConflict")<{}> {}

export class RegistrationUnavailable extends Schema.TaggedError<RegistrationUnavailable>()(
  "RegistrationUnavailable",
  { commitKnowledge: Schema.optional(CommitKnowledge) }
) {}

export class RegistrationOutcomeUnknown extends Schema.TaggedError<RegistrationOutcomeUnknown>()(
  "RegistrationOutcomeUnknown",
  { commitKnowledge: CommitKnowledge }
) {}

export type RegistrationFailure =
  | RegistrationInputRejected
  | RegistrationConflict
  | RegistrationUnavailable
  | RegistrationOutcomeUnknown

export interface RegistrationService {
  readonly create: (
    input: RegistrationInput
  ) => Effect.Effect<CreatedRegistration, RegistrationFailure>
}

export class Registration extends Context.Service<Registration, RegistrationService>()(
  "effect-auth/ai-docs/Registration"
) {}

export interface RegistrationStoreService {
  readonly create: (
    input: RegistrationInput
  ) => Effect.Effect<unknown, RegistrationConflict | RegistrationUnavailable>
}

export class RegistrationStore extends Context.Service<
  RegistrationStore,
  RegistrationStoreService
>()("effect-auth/ai-docs/RegistrationStore") {}

export type AuthenticationDecision = Data.TaggedEnum<{
  Allow: { readonly userId: UserId }
  Reject: {}
}>

export const AuthenticationDecision = Data.taggedEnum<AuthenticationDecision>()

export const redactedPassword = Redacted.make("correct horse battery staple")
