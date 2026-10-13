import { Repairs } from "@effect-jobs/playground-contracts/Repairs"
import { Operators } from "@effect-jobs/playground-contracts/Operators"
import { Context, Effect, Layer } from "effect"
import {
  SandboxAuthority,
  JobsRead,
  Scenarios
} from "@effect-jobs/playground-contracts/Services"

export type ApplicationService = typeof SandboxAuthority.Service &
  typeof JobsRead.Service &
  typeof Scenarios.Service &
  typeof Operators.Service & { readonly repairs: typeof Repairs.Service }
export class Application extends Context.Service<Application, ApplicationService>()(
  "playground/Application"
) {}
export const layerNoDeps = Layer.effect(
  Application,
  Effect.gen(function* () {
    const authority = yield* SandboxAuthority
    const read = yield* JobsRead
    const scenarios = yield* Scenarios
    const repairs = yield* Repairs
    const operators = yield* Operators
    return Application.of({ ...authority, ...read, ...scenarios, ...operators, repairs })
  })
)
