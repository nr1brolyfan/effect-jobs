import type { JobFailure } from "effect-jobs/JobFailure"
import type { HandlerInput } from "effect-jobs/JobContract"
import type { ScenarioPayload } from "@effect-jobs/playground-contracts/Definitions"
import type { Effect } from "effect"

// Serial registrar; executor installs handlers only after CF/scenario qualification.
export interface HandlerBindings<R = never> {
  readonly scenario: (
    input: HandlerInput<typeof ScenarioPayload.Type>
  ) => Effect.Effect<void, JobFailure, R>
}
