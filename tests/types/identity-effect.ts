import { Effect, Schema } from "effect"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import {
  type InvalidOperationId,
  type JobDeclarationError,
  type ProducerIdentity,
  validateOperationId
} from "../../src/JobIdentity.js"
const job = Effect.runSync(
  Job.make({
    name: "typed.identity",
    queue: Queue.make("types"),
    payload: Schema.String
  })
)
const producer = Effect.runSync(
  Producer.make({ operation: "typed.operation", slots: { run: job } })
)
const identity = producer.identity({ operationId: "request", slot: "run" })
const exact: Effect.Effect<
  ProducerIdentity<"typed.operation", "run">,
  InvalidOperationId | JobDeclarationError
> = identity
const validation: Effect.Effect<void, InvalidOperationId> = validateOperationId("request")
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type ExactIdentityError = Assert<
  Equal<Effect.Error<typeof identity>, InvalidOperationId | JobDeclarationError>
>
export type NoIdentityServices = Assert<Equal<Effect.Services<typeof identity>, never>>
// @ts-expect-error Identity is an Effect; validation cannot be skipped.
const eager: ProducerIdentity = identity
// @ts-expect-error Unknown slots remain rejected.
export const missingSlot = producer.identity({ operationId: "request", slot: "missing" })
void exact
void validation
void eager
