import { Effect } from "effect"
import * as Definitions from "../../src/scenarios/Definitions.js"

// One explicit host boundary for unit fixtures. Every consumer in these tests
// receives these same job/schema identities, including installed handler Layers.
export const definitions = Effect.runSync(Definitions.make)
export const runPromise = <A, E>(effect: Effect.Effect<A, E, Definitions.Definitions>) =>
  Effect.runPromise(
    effect.pipe(Effect.provideService(Definitions.Definitions, definitions))
  )
export const runPromiseExit = <A, E>(
  effect: Effect.Effect<A, E, Definitions.Definitions>
) =>
  Effect.runPromiseExit(
    effect.pipe(Effect.provideService(Definitions.Definitions, definitions))
  )
