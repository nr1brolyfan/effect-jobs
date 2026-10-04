/**
 * @title External APIs, time, and parsing boundaries
 */
import { Clock, Effect, Schema } from "effect"

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  "ProviderUnavailable",
  {}
) {}

declare const client: {
  readonly request: (options: { readonly signal: AbortSignal }) => Promise<unknown>
}

export const request = Effect.tryPromise({
  try: (signal) => client.request({ signal }),
  catch: () => new ProviderUnavailable()
})

declare const throwingLibrary: { readonly parse: (input: string) => unknown }

export const parse = (input: string) =>
  Effect.try({
    try: () => throwingLibrary.parse(input),
    catch: () => new ProviderUnavailable()
  })

export const now = Clock.currentTimeMillis

export const Username = Schema.String.pipe(
  Schema.check(Schema.isMinLength(3)),
  Schema.check(Schema.isMaxLength(64))
)

// Prefer Schema combinators or a small explicit parser for security grammars.
// A regex must be static, simple, anchored, reviewed, and covered by boundary tests.

/*
// Avoid fake throwing boundaries around operations that do not throw.
Effect.try({
  try: () => value.replaceAll("-", ""),
  catch: () => new ProviderUnavailable()
})

// Avoid Date.now() in Effect operation logic; Clock/TestClock keeps tests deterministic.
*/
