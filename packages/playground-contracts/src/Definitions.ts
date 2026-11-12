import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import { SandboxRef } from "./Sandbox.js"
import { ScenarioId } from "./Scenarios.js"

export const queue = JobQueue.make("playground")
export const ScenarioPayload = Schema.Struct({
  sandbox: SandboxRef,
  scenario: ScenarioId,
  sequence: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 10 })))
})
export const ScenarioDefinitionsProgram = Effect.gen(function* () {
  const ScenarioJob = yield* Job.make({
    queue,
    name: "playground.scenario",
    version: 1,
    payload: ScenarioPayload
  })
  const ScenarioProducer = yield* JobProducer.make({
    operation: "playground.scenario",
    slots: { execute: ScenarioJob }
  })
  return { ScenarioJob, ScenarioProducer }
})

export class ScenarioDefinitions extends Context.Service<
  ScenarioDefinitions,
  Effect.Success<typeof ScenarioDefinitionsProgram>
>()("@effect-jobs/playground-contracts/ScenarioDefinitions") {}

export const ScenarioDefinitionsLayer = Layer.effect(
  ScenarioDefinitions,
  ScenarioDefinitionsProgram
)
