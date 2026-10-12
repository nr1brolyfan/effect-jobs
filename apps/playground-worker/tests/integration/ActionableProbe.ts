import { Effect, Redacted } from "effect"
import * as Event from "../../src/execution/Event.js"
import * as Executor from "../../src/execution/Executor.js"
import { Application } from "../../../website/src/server/Services.js"
// Independent native scopes exercise actual PG locks, without the Gateway DO's serialization.
export const describe = (config: Event.Config, credential: string) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.describe(yield* app.authenticate(Redacted.make(credential)))
    })
  )

export const reset = (
  config: Event.Config,
  credential: string,
  command: import("@effect-jobs/playground-contracts/Scenarios").ResetCommand
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.reset(yield* app.authenticate(Redacted.make(credential)), command)
    })
  )

export const generate = (config: Event.Config) =>
  Event.run(config, Effect.void, Executor.generate(config.schema))
