/** Typed, application-local producer bindings for durable consequences. */
import { Effect, Schema } from "effect"
import type { JobDefinition } from "./Job.js"
import type { EnqueueInput, EnqueueOptions, EnqueueResult } from "./JobContract.js"
import { InvalidJobInput } from "./JobContract.js"
import { JobEnqueue, type JobBackendError } from "./JobEnqueue.js"
import type { JobEnqueueError } from "./JobTransaction.js"
import type { JobPolicy } from "./JobPolicy.js"
import {
  CatalogIdentity,
  JobDeclarationError,
  OperationId,
  validateOperationId,
  validateProducerDeclaration
} from "./JobIdentity.js"
import type { ProducerIdentity } from "./JobIdentity.js"

/** A binding retains the payload Schema, default presence and ambient enqueue.
 * @category models
 */
export interface JobBinding {
  readonly catalog: CatalogIdentity
  readonly payload: Schema.Top
  readonly defaultPolicy: JobPolicy | undefined
  enqueue(
    input: EnqueueInput<unknown, JobPolicy>
  ): Effect.Effect<EnqueueResult, JobEnqueueError | JobBackendError, unknown>
}

/** Slot-specific input without the derived producer tuple.
 * @category models
 */
export type BoundEnqueueInput<Definition extends JobBinding> = EnqueueOptions<
  Definition["payload"]["Type"],
  Definition["defaultPolicy"]
> & { readonly operationId: string }

/** Immutable operation and slot-to-job bindings. identity is structural, not binding proof.
 * @category models
 */
export interface JobProducer<
  Operation extends string,
  Slots extends Readonly<Record<string, JobBinding>>
> {
  readonly operation: Operation
  readonly slots: Readonly<Slots>
  readonly identity: <const Slot extends keyof Slots & string>(input: {
    readonly operationId: string
    readonly slot: Slot
  }) => ProducerIdentity<Operation, Slot>
  readonly enqueue: <const Slot extends keyof Slots & string>(
    ...args: { [K in Slot]: readonly [slot: K, input: BoundEnqueueInput<Slots[K]>] }[Slot]
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | Slots[Slot]["payload"]["EncodingServices"]
  >
}

const enqueueBound = <Payload extends Schema.Top, Default extends JobPolicy | undefined>(
  definition: Pick<
    JobDefinition<Payload, string, number, string, Default>,
    "payload" | "defaultPolicy" | "enqueue"
  >,
  producer: ProducerIdentity,
  input: EnqueueOptions<Payload["Type"], Default>
) => definition.enqueue({ ...input, producer })

/** Declares nonempty slot bindings near the owning business operation.
 * Bound enqueue selects the contract and joins the existing transaction; it never
 * begins, commits or replays one. identity remains useful for lower-level calls.
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import * as Job from "effect-jobs/Job"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Policy from "effect-jobs/JobPolicy"
 * import * as Producer from "effect-jobs/JobProducer"
 * const SendInvoice = Job.make({ name: "invoice.send", queue: Queue.make("billing"), payload: Schema.Struct({ invoiceId: Schema.String }), defaultPolicy: Policy.defaultPolicy })
 * const producer = Producer.make({ operation: "invoice.create", slots: { delivery: SendInvoice } })
 * const enqueue = producer.enqueue("delivery", { operationId: "request-123", payload: { invoiceId: "invoice-1" } })
 * ```
 * @category constructors
 */
export const make = <
  const Operation extends string,
  const Slots extends Readonly<Record<string, JobBinding>>
>(options: {
  readonly operation: Operation
  readonly slots: Slots
}): JobProducer<Operation, Slots> => {
  if (
    options.slots === null ||
    typeof options.slots !== "object" ||
    Array.isArray(options.slots)
  ) {
    throw new JobDeclarationError({
      field: "slots",
      expected: "a nonempty slot-to-job record"
    })
  }
  validateProducerDeclaration({
    operation: options.operation,
    slots: Object.keys(options.slots)
  })
  for (const definition of Object.values(options.slots)) {
    if (
      definition === null ||
      typeof definition !== "object" ||
      !Schema.is(CatalogIdentity)(definition.catalog) ||
      !Schema.isSchema(definition.payload) ||
      typeof definition.enqueue !== "function"
    ) {
      throw new JobDeclarationError({
        field: "slots",
        expected: "job definitions as slot values"
      })
    }
  }
  const operation = options.operation
  const slots = Object.freeze({ ...options.slots })
  const identity = <const Slot extends keyof Slots & string>(input: {
    readonly operationId: string
    readonly slot: Slot
  }): ProducerIdentity<Operation, Slot> => {
    validateOperationId(input.operationId)
    if (!Object.hasOwn(slots, input.slot)) {
      throw new JobDeclarationError({ field: "slots", expected: "a declared slot" })
    }
    return Object.freeze({ operation, operationId: input.operationId, slot: input.slot })
  }
  return Object.freeze({
    operation,
    slots,
    identity,
    enqueue: <const Slot extends keyof Slots & string>(
      ...args: {
        [K in Slot]: readonly [slot: K, input: BoundEnqueueInput<Slots[K]>]
      }[Slot]
    ) =>
      Effect.suspend(() => {
        const [slot, input] = args
        if (!Object.hasOwn(slots, slot) || !Schema.is(OperationId)(input.operationId)) {
          return Effect.fail(new InvalidJobInput({ field: "producer" }))
        }
        return enqueueBound<Slots[Slot]["payload"], Slots[Slot]["defaultPolicy"]>(
          slots[slot],
          { operation, operationId: input.operationId, slot },
          input
        )
      })
  })
}
