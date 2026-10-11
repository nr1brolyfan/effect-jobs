import { Schema } from "effect"
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
export const ScenarioJob = Job.make({
  queue,
  kind: "playground.scenario",
  version: 1,
  payload: ScenarioPayload
})
export const ScenarioProducer = JobProducer.make({
  operation: "playground.scenario",
  slots: ["execute"]
})
