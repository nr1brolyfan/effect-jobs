import { Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import type { JobDeclarationError } from "../../src/JobIdentity.js"

const job = Effect.runSync(
  Job.make({
    queue: Queue.make("typed"),
    name: "setup.run",
    payload: Schema.String
  })
)
export const setup = Producer.make({ operation: "typed.run", slots: { execute: job } })
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type ExactSetupError = Assert<
  Equal<Effect.Error<typeof setup>, JobDeclarationError>
>
export type NoSetupServices = Assert<Equal<Effect.Services<typeof setup>, never>>
export type ExactSetupSuccess = Assert<
  Equal<
    Effect.Success<typeof setup>,
    Producer.JobProducer<"typed.run", { readonly execute: typeof job }>
  >
>
// @ts-expect-error Producer setup must execute before its slots are available.
export const eager = setup.slots
const producer = Effect.runSync(setup)
export const literalOperation: "typed.run" = producer.operation
export const exactJob: typeof job = producer.slots.execute
// @ts-expect-error Undeclared slots remain absent after effectful setup.
export const unknownSlot = producer.slots.missing
