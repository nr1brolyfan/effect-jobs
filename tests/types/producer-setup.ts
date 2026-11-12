import { Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import type { JobDeclarationError } from "../../src/JobIdentity.js"
const job = Effect.runSync(Job.make({ name: "setup.run", payload: Schema.String }))
export const setup = Producer.make("typed.run").pipe(
  Producer.withSlot("execute", job, { queue: Queue.make("typed") })
)
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type Error = Assert<
  Equal<Effect.Error<typeof setup>, JobDeclarationError | Producer.InvalidProducerBinding>
>
export type Services = Assert<Equal<Effect.Services<typeof setup>, never>>
// @ts-expect-error Setup must execute before slots are available.
export const eager = setup.slots
const resolved = Effect.runSync(setup)
export const operation: "typed.run" = resolved.operation
export const exactJob: typeof job = resolved.slots.execute.job
// @ts-expect-error Unknown slots remain absent.
export const removedSlot = resolved.slots.missing
