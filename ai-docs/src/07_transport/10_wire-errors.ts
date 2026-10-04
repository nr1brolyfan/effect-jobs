/**
 * @title Explicit domain-to-wire projection
 */
import { Match, Schema } from "effect"
import type { RegistrationFailure } from "../fixtures/Auth.js"

export const RegistrationWireError = Schema.Union([
  Schema.TaggedStruct("RegistrationValidationError", {
    reason: Schema.Literal("malformed")
  }),
  Schema.TaggedStruct("RegistrationConflictError", {
    field: Schema.Literal("username")
  }),
  Schema.TaggedStruct("RegistrationUnavailableError", {}),
  Schema.TaggedStruct("RegistrationOutcomeUnconfirmedError", {})
])
export type RegistrationWireError = typeof RegistrationWireError.Type

export const toRegistrationWireError = (
  error: RegistrationFailure
): RegistrationWireError =>
  Match.value(error).pipe(
    Match.when({ _tag: "RegistrationInputRejected" }, () => ({
      _tag: "RegistrationValidationError" as const,
      reason: "malformed" as const
    })),
    Match.when({ _tag: "RegistrationConflict" }, () => ({
      _tag: "RegistrationConflictError" as const,
      field: "username" as const
    })),
    Match.when({ _tag: "RegistrationOutcomeUnknown" }, () => ({
      _tag: "RegistrationOutcomeUnconfirmedError" as const
    })),
    Match.when({ _tag: "RegistrationUnavailable" }, () => ({
      _tag: "RegistrationUnavailableError" as const
    })),
    Match.exhaustive
  )

export const encodeRegistrationWireError = Schema.encodeSync(RegistrationWireError)

/*
// Avoid: domain errors may contain Cause, provider data, messages, or stacks.
return JSON.stringify({ ...domainError })
*/
