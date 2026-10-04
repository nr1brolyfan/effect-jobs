/**
 * @title Typed errors, ownership, and Cause
 *
 * Use the typed channel normally. Inspect Cause only when mixed reasons must survive.
 */
import { Effect, Match, Schema } from "effect"
import { sanitizeEffectCause } from "../../../src/server/internal/CauseSanitization.js"
import {
  RegistrationConflict,
  RegistrationOutcomeUnknown,
  RegistrationUnavailable
} from "../fixtures/Auth.js"

export class StoreDefect extends Schema.TaggedError<StoreDefect>()("StoreDefect", {}) {}

const sanitizeFailure = Match.type<unknown>().pipe(
  Match.when(Match.instanceOf(RegistrationConflict), () => new RegistrationConflict()),
  Match.when(
    Match.instanceOf(RegistrationOutcomeUnknown),
    () => new RegistrationOutcomeUnknown({ commitKnowledge: "Unknown" })
  ),
  Match.orElse(() => new RegistrationUnavailable({}))
)

// This data-last operator preserves mixed failures and interruptions while
// replacing provider failures and defects with fresh operation-owned values.
export const sanitizeStore = sanitizeEffectCause(sanitizeFailure, () => new StoreDefect())

declare const recoverConflict: Effect.Effect<string>
declare const mutation: Effect.Effect<
  string,
  RegistrationConflict | RegistrationUnavailable
>

// Ordinary expected recovery stays in the typed channel.
export const recovered = mutation.pipe(
  Effect.catchTag("RegistrationConflict", () => recoverConflict)
)

/*
// Avoid: a mixed Cause is not equivalent to one expected failure found inside it.
effect.pipe(
  Effect.catchCause((cause) =>
    Effect.fail(firstFailure(cause) ?? new RegistrationUnavailable({}))
  )
)
*/
