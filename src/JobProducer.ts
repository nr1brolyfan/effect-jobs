/** Declares producer operations with typed contract, routing and default-policy bindings. */
import { Data, Effect, Exit, Pipeable, Schema } from "effect"
import type { JobDefinition } from "./Job.js"
import type { JobQueue } from "./JobQueue.js"
import { defaultPolicy, EpochMillis, JobPolicy } from "./JobPolicy.js"
import {
  JobKind,
  JobVersion,
  JobDeclarationError,
  SlotName,
  nameFormat,
  validateOperationId,
  QueueName,
  validateProducerDeclaration
} from "./JobIdentity.js"
import type { InvalidOperationId } from "./JobIdentity.js"
import { InvalidJobInput } from "./JobContract.js"
import type { EnqueueResult, PreparedJob } from "./JobContract.js"
import { JobEnqueue } from "./JobEnqueue.js"
import type { JobBackendError } from "./JobEnqueue.js"
import type { JobEnqueueError, JobsTransaction } from "./JobTransaction.js"
import { encodeJobPayload } from "./JobPayloadCodec.js"
import { observe } from "./JobTelemetry.js"
import { insertPreparing } from "./internal/JobTransaction.js"
import { prepareProjection } from "./internal/codec/ProtectedProjection.js"

/** One consequence's job contract, default destination and resolved default policy. */
export interface Binding {
  readonly job: JobDefinition
  readonly queue: JobQueue
  readonly policy?: JobPolicy
}
/** Named consequences; aliases are persisted producer slots. */
export type Bindings = Readonly<Record<string, Binding>>

/** Per-production data; omitted routing/policy use the selected slot's defaults. */
export interface Input<D extends Bindings, K extends keyof D & string> {
  readonly slot: K
  readonly operationId: string
  readonly payload: NoInfer<D[K]["job"]["payload"]["Type"]>
  /** Replaces only this production's default route; never moves a matching duplicate. */
  readonly queue?: JobQueue
  /** Complete resolved policy replacement, not a partial merge or retained-job update. */
  readonly policy?: JobPolicy
  readonly availableAt?: number
}

/** Immutable operation declaration and typed production methods; no transaction ownership on joined enqueue. */
export interface JobProducer<Operation extends string, D extends Bindings>
  extends Pipeable.Pipeable {
  readonly operation: Operation
  readonly slots: D
  readonly enqueue: <const K extends keyof D & string>(
    input: Input<D, K>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | D[K]["job"]["payload"]["EncodingServices"]
  >
  readonly enqueueStandalone: <const K extends keyof D & string>(
    input: Input<D, K>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | D[K]["job"]["payload"]["EncodingServices"]
  >
  readonly enqueueInTransaction: <E, R, const K extends keyof D & string>(
    tx: JobsTransaction<E, R>,
    input: Input<D, K>
  ) => Effect.Effect<
    EnqueueResult,
    E | JobEnqueueError,
    R | D[K]["job"]["payload"]["EncodingServices"]
  >
}

/** Invalid static slot configuration; diagnostics expose only declaration names. */
export class InvalidProducerBinding extends Data.TaggedError("InvalidProducerBinding")<{
  readonly slot: string
  readonly field: "job" | "queue" | "policy" | "payload"
}> {}

const snapshotPolicy = (policy: JobPolicy): JobPolicy =>
  Object.freeze({
    ...policy,
    retrySchedule: Object.freeze({ ...policy.retrySchedule }),
    completedRetention: Object.freeze({ ...policy.completedRetention }),
    deadRetention: Object.freeze({ ...policy.deadRetention })
  })

const QueueRoute = Schema.Struct({ name: QueueName })

type ResolvedBinding<Job extends JobDefinition, Queue extends JobQueue> = {
  readonly job: Job
  readonly queue: Queue
  readonly policy: JobPolicy
}

/**
 * Starts an immutable producer declaration. Add consequences with withSlot;
 * an empty declaration has no legal enqueue slot. Construction starts no work.
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import * as Producer from "effect-jobs/JobProducer"
 * import * as Queue from "effect-jobs/JobQueue"
 *
 * const producer = Producer.make("invoice.create").pipe(
 *   Producer.withSlot("generate",
 *     { kind: "invoice.generate", version: 1, payload: Schema.String },
 *     { queue: Queue.make("billing") }
 *   )
 * )
 * const produce = producer.enqueue({ slot: "generate", operationId: "request-123", payload: "invoice-123" })
 * ```
 */
export const make = <const Operation extends string>(
  operation: Operation
): JobProducer<Operation, {}> => {
  validateProducerDeclaration({ operation, slots: [] })
  return assemble(operation, Object.freeze({}))
}

/**
 * Adds one immutable binding, preserving prior slot types and Schema services.
 * Duplicate names fail synchronously, never overwrite. Configuration is copied
 * when applied; omitted policy resolves to defaultPolicy. Enqueue overrides and
 * matching-duplicate first-write-wins semantics are independent of assembly.
 */
export const withSlot =
  <
    const Slot extends string,
    const Job extends JobDefinition,
    const Queue extends JobQueue
  >(
    slot: Slot,
    job: Job,
    options: { readonly queue: Queue; readonly policy?: JobPolicy }
  ) =>
  <Operation extends string, D extends Bindings>(
    self: JobProducer<Operation, D> &
      ([Extract<Slot, keyof NoInfer<D>>] extends [never] ? unknown : never)
  ): JobProducer<
    Operation,
    D & { readonly [K in Slot]: ResolvedBinding<Job, Queue> }
  > => {
    const field = `slots[${Object.keys(self.slots).length}]` as const
    if (!Schema.is(SlotName)(slot)) {
      throw new JobDeclarationError({
        field,
        value: slot,
        expected: `1–128 ASCII characters matching ${nameFormat}`
      })
    }
    if (Object.hasOwn(self.slots, slot)) {
      throw new JobDeclarationError({
        field,
        value: slot,
        expected: "unique declared slot"
      })
    }
    if (
      !Schema.is(JobKind)(job.kind) ||
      !Schema.is(JobVersion)(job.version) ||
      !Schema.isSchema(job.payload)
    ) {
      throw new InvalidProducerBinding({ slot, field: "job" })
    }
    if (!Schema.is(QueueName)(options.queue.name)) {
      throw new InvalidProducerBinding({ slot, field: "queue" })
    }
    if (!Schema.is(JobPolicy)(options.policy ?? defaultPolicy)) {
      throw new InvalidProducerBinding({ slot, field: "policy" })
    }
    // Declaration-time traversal is pure and requires no Schema encoding services.
    if (Exit.isFailure(Effect.runSyncExit(prepareProjection(job.payload)))) {
      throw new InvalidProducerBinding({ slot, field: "payload" })
    }
    return assemble(
      self.operation,
      Object.freeze({
        ...self.slots,
        [slot]: Object.freeze({
          job: Object.freeze({ ...job }),
          queue: Object.freeze({ ...options.queue }),
          policy: snapshotPolicy(options.policy ?? defaultPolicy)
        })
      }) as D & { readonly [K in Slot]: ResolvedBinding<Job, Queue> }
    )
  }

const assemble = <Operation extends string, D extends Bindings>(
  operation: Operation,
  slots: D
): JobProducer<Operation, D> => {
  const prepare = Effect.fnUntraced(function* <const K extends keyof D & string>(
    input: Input<D, K>
  ) {
    const slot = input.slot
    const operationId = input.operationId
    const availableAt = input.availableAt
    const payload = input.payload
    if (!Object.hasOwn(slots, slot) || typeof operationId !== "string") {
      return yield* new InvalidJobInput({ field: "producer" })
    }
    yield* Effect.try({
      try: () => validateOperationId(operationId),
      catch: (error) => error as InvalidOperationId
    })
    if (availableAt !== undefined && !Schema.is(EpochMillis)(availableAt)) {
      return yield* new InvalidJobInput({ field: "availableAt" })
    }
    const binding = slots[slot]!
    const destination = input.queue
    const configured = input.policy
    if (destination !== undefined && !Schema.is(QueueRoute)(destination)) {
      return yield* new InvalidJobInput({ field: "catalog" })
    }
    if (configured !== undefined && !Schema.is(JobPolicy)(configured)) {
      return yield* new InvalidJobInput({ field: "policy" })
    }
    // Snapshot caller-owned overrides before Schema services can suspend encoding.
    const queueName = destination === undefined ? binding.queue.name : destination.name
    const policy = configured === undefined ? binding.policy! : snapshotPolicy(configured)
    const producer = Object.freeze({
      operation,
      operationId,
      slot
    })
    const encoded = yield* encodeJobPayload<D[K]["job"]["payload"]>(
      binding.job.payload,
      payload
    )
    return Object.freeze({
      catalog: Object.freeze({
        queue: queueName,
        kind: binding.job.kind,
        version: binding.job.version
      }),
      producer,
      policy,
      encoded,
      ...(availableAt === undefined ? {} : { availableAt })
    }) satisfies PreparedJob
  })
  return Object.freeze({
    ...Pipeable.Prototype,
    operation,
    slots,
    enqueue: Effect.fnUntraced(function* <const K extends keyof D & string>(
      input: Input<D, K>
    ) {
      const backend = yield* JobEnqueue
      return yield* backend
        .enqueue(prepare(input))
        .pipe(observe("enqueue", "provisional"))
    }),
    enqueueStandalone: Effect.fnUntraced(function* <const K extends keyof D & string>(
      input: Input<D, K>
    ) {
      const backend = yield* JobEnqueue
      return yield* backend
        .enqueueStandalone(prepare(input))
        .pipe(observe("enqueue-standalone", "committed"))
    }),
    enqueueInTransaction: <E, R, const K extends keyof D & string>(
      tx: JobsTransaction<E, R>,
      input: Input<D, K>
    ) => insertPreparing(tx, prepare(input)).pipe(observe("enqueue", "provisional"))
  })
}
