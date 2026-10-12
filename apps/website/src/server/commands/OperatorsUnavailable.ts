import { Effect, Layer } from "effect"
import { Operators } from "@effect-jobs/playground-contracts/Operators"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"

// Staged integration fails closed until the qualified library/native adapter is wired.
// This layer must be removed from Event composition when operator persistence lands.
const unavailable = () =>
  Effect.fail(new PlaygroundError({ code: "capability-unavailable" }))
export const layer = Layer.succeed(Operators, {
  execute: unavailable,
  receipt: unavailable
})
