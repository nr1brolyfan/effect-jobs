/** Declares producer operations with typed contract, routing and default-policy bindings. */
import { Data, Effect, Exit, Schema } from "effect"
import type { Definition } from "./JobGroup.js"
import type { JobQueue } from "./JobQueue.js"
import type { JobPolicy } from "./JobPolicy.js"
import { defaultPolicy, EpochMillis, PersistedJobPolicy } from "./JobPolicy.js"
import {
  JobKind,
  JobVersion,
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

/** One consequence's job contract, destination and resolved default policy. */
export interface Binding {
  readonly job: Definition
  readonly queue: JobQueue
  readonly policy?: JobPolicy
}
/** Nonempty named consequences; aliases are persisted producer slots. */
export type Bindings = Readonly<Record<string, Binding>>

/** Per-production data; routing and policy are fixed by the selected slot. */
export interface Input<D extends Bindings, K extends keyof D & string> {
  readonly slot: K
  readonly operationId: string
  readonly payload: NoInfer<D[K]["job"]["payload"]["Type"]>
  readonly availableAt?: number
}

/** Immutable operation declaration and typed production methods; no transaction ownership on joined enqueue. */
export interface JobProducer<Operation extends string, D extends Bindings> {
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

/**
 * Binds consequences once; runtime operation IDs are validated by enqueue in Effect.
 * Omitted slot policy resolves to defaultPolicy. Imports and construction start no work.
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import * as Producer from "effect-jobs/JobProducer"
 * import * as Queue from "effect-jobs/JobQueue"
 *
 * const producer = Producer.make({ operation: "invoice.create", slots: {
 *   generate: {
 *     job: { kind: "invoice.generate", version: 1, payload: Schema.String },
 *     queue: Queue.make("billing")
 *   }
 * } })
 * const produce = producer.enqueue({ slot: "generate", operationId: "request-123", payload: "invoice-123" })
 * ```
 */
export const make = <const Operation extends string, const D extends Bindings>(options: {
  readonly operation: Operation
  readonly slots: D
}): JobProducer<Operation, D> => {
  const entries = Object.entries(options.slots)
  validateProducerDeclaration({
    operation: options.operation,
    slots: entries.map((entry) => entry[0])
  })
  const operation = options.operation
  for (const entry of entries) {
    const binding = entry[1]
    if (
      !Schema.is(JobKind)(binding.job.kind) ||
      !Schema.is(JobVersion)(binding.job.version) ||
      !Schema.isSchema(binding.job.payload)
    ) {
      throw new InvalidProducerBinding({ slot: entry[0], field: "job" })
    }
    if (!Schema.is(QueueName)(binding.queue.name)) {
      throw new InvalidProducerBinding({ slot: entry[0], field: "queue" })
    }
    if (!Schema.is(PersistedJobPolicy)(binding.policy ?? defaultPolicy)) {
      throw new InvalidProducerBinding({ slot: entry[0], field: "policy" })
    }
    // Declaration-time traversal is pure and requires no Schema encoding services.
    if (Exit.isFailure(Effect.runSyncExit(prepareProjection(binding.job.payload)))) {
      throw new InvalidProducerBinding({ slot: entry[0], field: "payload" })
    }
  }
  const slots = Object.freeze(
    Object.fromEntries(
      entries.map((entry) => [
        entry[0],
        Object.freeze({
          job: Object.freeze({ ...entry[1].job }),
          queue: Object.freeze({ ...entry[1].queue }),
          policy: snapshotPolicy(entry[1].policy ?? defaultPolicy)
        })
      ])
    )
  ) as D

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
        queue: binding.queue.name,
        kind: binding.job.kind,
        version: binding.job.version
      }),
      producer,
      policy: binding.policy!,
      encoded,
      ...(availableAt === undefined ? {} : { availableAt })
    }) satisfies PreparedJob
  })
  return Object.freeze({
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
