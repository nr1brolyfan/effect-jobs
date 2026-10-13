import { Effect, Redacted } from "effect"
import * as Event from "../../src/execution/Event.js"
import * as Executor from "../../src/execution/Executor.js"
import { Application } from "../../../website/src/server/Services.js"
// Independent native scopes exercise actual PG locks, without the Gateway DO's serialization.
export const issue = (config: Event.Config) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.issue()
    })
  )

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

export const scenario = (
  config: Event.Config,
  credential: string,
  command: import("@effect-jobs/playground-contracts/Scenarios").ScenarioCommand
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.run(yield* app.authenticate(Redacted.make(credential)), command)
    })
  ).pipe(
    Effect.catchTag("PlaygroundError", (error) => Effect.succeed({ code: error.code }))
  )

export const operator = (
  config: Event.Config,
  credential: string,
  command: import("@effect-jobs/playground-contracts/Operators").JobOperatorCommand
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.execute(
        yield* app.authenticate(Redacted.make(credential)),
        command
      )
    })
  )
