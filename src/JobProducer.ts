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
  type InvalidOperationId,
  JobDeclarationError,
  OperationId,
  validateOperationId
} from "./JobIdentity.js"
import type { ProducerIdentity } from "./JobIdentity.js"
import { declaration } from "./internal/ProducerDeclaration.js"

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
  }) => Effect.Effect<
    ProducerIdentity<Operation, Slot>,
    InvalidOperationId | JobDeclarationError
  >
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

/** Lazily validates and snapshots nonempty slot bindings near the owning business operation.
 * Each execution creates fresh immutable configuration and reports JobDeclarationError in E.
 * Bound enqueue selects the contract and joins the existing transaction; it never
 * begins, commits or replays one. identity remains useful for lower-level calls.
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Job from "effect-jobs/Job"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Policy from "effect-jobs/JobPolicy"
 * import * as Producer from "effect-jobs/JobProducer"
 * const setup = Effect.gen(function* () {
 *   const definition = yield* Job.make({ name: "invoice.send", queue: Queue.make("billing"), payload: Schema.Struct({ invoiceId: Schema.String }), defaultPolicy: Policy.defaultPolicy })
 *   const producer = yield* Producer.make({ operation: "invoice.create", slots: { delivery: definition } })
 *   const enqueue = producer.enqueue("delivery", { operationId: "request-123", payload: { invoiceId: "invoice-1" } })
 *   return { definition, producer, enqueue }
 * })
 * ```
 * @category constructors
 */
export const make = <
  const Operation extends string,
  const Slots extends Readonly<Record<string, JobBinding>>
>(options: {
  readonly operation: Operation
  readonly slots: Slots
}): Effect.Effect<JobProducer<Operation, Slots>, JobDeclarationError> =>
  Effect.gen(function* () {
    const operation = options.operation
    const configuredSlots = options.slots
    if (
      configuredSlots === null ||
      typeof configuredSlots !== "object" ||
      Array.isArray(configuredSlots)
    ) {
      return yield* new JobDeclarationError({
        field: "slots",
        expected: "a nonempty slot-to-job record"
      })
    }
    const slots = Object.freeze({ ...configuredSlots })
    yield* Effect.fromResult(declaration({ operation, slots: Object.keys(slots) }))
    for (const definition of Object.values(slots)) {
      if (
        definition === null ||
        typeof definition !== "object" ||
        !Schema.is(CatalogIdentity)(definition.catalog) ||
        !Schema.isSchema(definition.payload) ||
        typeof definition.enqueue !== "function"
      ) {
        return yield* new JobDeclarationError({
          field: "slots",
          expected: "job definitions as slot values"
        })
      }
    }
    const identity = <const Slot extends keyof Slots & string>(input: {
      readonly operationId: string
      readonly slot: Slot
    }): Effect.Effect<
      ProducerIdentity<Operation, Slot>,
      InvalidOperationId | JobDeclarationError
    > =>
      Effect.gen(function* () {
        const operationId = input.operationId
        const slot = input.slot
        yield* validateOperationId(operationId)
        if (!Object.hasOwn(slots, slot)) {
          return yield* new JobDeclarationError({
            field: "slots",
            expected: "a declared slot"
          })
        }
        return Object.freeze({ operation, operationId, slot })
      })

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
  })
