/** Declares producer operations with typed contract, routing and default-policy bindings. */
import { Data, Effect, Pipeable, Schema } from "effect"
import type { JobDefinition } from "./Job.js"
import type { JobQueue } from "./JobQueue.js"
import { defaultPolicy, EpochMillis, JobPolicy } from "./JobPolicy.js"
import {
  JobName,
  JobVersion,
  JobDeclarationError,
  SlotName,
  nameFormat,
  validateOperationId,
  QueueName
} from "./JobIdentity.js"
import { InvalidJobInput } from "./JobContract.js"
import type { EnqueueResult, PreparedJob } from "./JobContract.js"
import { JobEnqueue } from "./JobEnqueue.js"
import type { JobPersistenceError } from "./JobEnqueue.js"
import type { JobEnqueueError, JobsTransaction } from "./JobTransaction.js"
import { encodeJobPayload } from "./JobPayloadCodec.js"
import { observe } from "./JobTelemetry.js"
import { declaration } from "./internal/ProducerDeclaration.js"
import { insertPreparing } from "./internal/JobTransaction.js"
import { prepareProjection } from "./internal/codec/ProtectedProjection.js"

/** Exactly one route declaration; selectable queues have no implicit default. */
export type Routing =
  | { readonly queue: JobQueue; readonly queues?: never }
  | { readonly queues: readonly [JobQueue, ...JobQueue[]]; readonly queue?: never }

/** One consequence's contract, closed routing declaration and resolved policy. */
export type Binding = Routing & {
  readonly job: JobDefinition
  readonly policy?: JobPolicy
}
/** Named consequences; aliases are persisted producer slots. */
export type Bindings = Readonly<Record<string, Binding>>

/** Discriminated per-slot inputs preserve payload/routing correlation, including unions. */
export type Input<D extends Bindings, K extends keyof D & string = keyof D & string> = {
  [S in K]: {
    readonly slot: S
    readonly operationId: string
    readonly payload: D[S]["job"]["payload"]["Type"]
    /** Complete resolved replacement, never a partial merge or retained-job update. */
    readonly policy?: JobPolicy
    readonly availableAt?: number
  } & (D[S] extends { readonly queues: ReadonlyArray<JobQueue<infer Name>> }
    ? { readonly queue: Name }
    : { readonly queue?: never })
}[K]

/** Immutable operation declaration and typed production methods; no transaction ownership on joined enqueue. */
export interface JobProducer<Operation extends string, D extends Bindings>
  extends Pipeable.Pipeable {
  readonly operation: Operation
  readonly slots: D
  readonly enqueue: <const K extends keyof D & string>(
    input: Input<D, K> & { readonly slot: K }
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobPersistenceError,
    JobEnqueue | D[K]["job"]["payload"]["EncodingServices"]
  >
  readonly enqueueStandalone: <const K extends keyof D & string>(
    input: Input<D, K> & { readonly slot: K }
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobPersistenceError,
    JobEnqueue | D[K]["job"]["payload"]["EncodingServices"]
  >
  readonly enqueueInTransaction: <E, R, const K extends keyof D & string>(
    tx: JobsTransaction<E, R>,
    input: Input<D, K> & { readonly slot: K }
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

const snapshotPolicy = (policy: JobPolicy): JobPolicy => {
  const snapshot = { ...policy }
  return Object.freeze({
    ...snapshot,
    retrySchedule: Object.freeze({ ...snapshot.retrySchedule }),
    completedRetention: Object.freeze({ ...snapshot.completedRetention }),
    deadRetention: Object.freeze({ ...snapshot.deadRetention })
  })
}

type ResolvedBinding<Job extends JobDefinition, Route extends Routing> = Route & {
  readonly job: Job
  readonly policy: JobPolicy
}

/**
 * Starts an immutable producer declaration. Add consequences with withSlot;
 * an empty declaration has no legal enqueue slot. Construction starts no work.
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Producer from "effect-jobs/JobProducer"
 * import * as Queue from "effect-jobs/JobQueue"
 *
 * const setup = Effect.gen(function* () {
 * const producer = yield* Producer.make("invoice.create").pipe(
 *   Producer.withSlot("generate",
 *     { name: "invoice.generate", version: 1, payload: Schema.String },
 *     { queue: Queue.make("billing") }
 *   )
 * )
 * return producer
 * // Use producer.enqueue({ slot: "generate", operationId: "request-123", payload: "invoice-123" }) inside an owning transaction.
 * })
 * ```
 */
export const make = <const Operation extends string>(
  operation: Operation
): Effect.Effect<JobProducer<Operation, {}>, JobDeclarationError> =>
  Effect.gen(function* () {
    yield* Effect.fromResult(declaration({ operation, slots: [] }))
    return assemble(operation, Object.freeze({}))
  })

/**
 * Adds one immutable binding, preserving prior slot types and Schema services.
 * Duplicate names fail in the typed channel, never overwrite. Configuration is copied
 * when the setup Effect executes; omitted policy resolves to defaultPolicy. Explicit choices and
 * matching-duplicate first-write-wins semantics are independent of assembly.
 */
export const withSlot =
  <
    const Slot extends string,
    const Job extends JobDefinition,
    const Route extends Routing
  >(
    slot: Slot,
    job: Job,
    options: Route & { readonly policy?: JobPolicy; readonly defaultQueue?: never }
  ) =>
  <Operation extends string, D extends Bindings, E, R>(
    effect: Effect.Effect<JobProducer<Operation, D>, E, R> &
      ([Extract<Slot, keyof NoInfer<D>>] extends [never] ? unknown : never)
  ): Effect.Effect<
    JobProducer<Operation, D & { readonly [K in Slot]: ResolvedBinding<Job, Route> }>,
    E | JobDeclarationError | InvalidProducerBinding,
    R
  > =>
    Effect.flatMap(
      effect,
      Effect.fnUntraced(function* (self) {
        const field = `slots[${Object.keys(self.slots).length}]` as const
        if (!Schema.is(SlotName)(slot)) {
          return yield* new JobDeclarationError({
            field,
            value: slot,
            expected: `1–128 ASCII characters matching ${nameFormat}`
          })
        }
        if (Object.hasOwn(self.slots, slot)) {
          return yield* new JobDeclarationError({
            field,
            value: slot,
            expected: "unique declared slot"
          })
        }
        if (job === null || typeof job !== "object") {
          return yield* new InvalidProducerBinding({ slot, field: "job" })
        }
        const contract = Object.freeze({
          name: job.name,
          version: job.version,
          payload: job.payload
        })
        if (
          !Schema.is(JobName)(contract.name) ||
          !Schema.is(JobVersion)(contract.version) ||
          !Schema.isSchema(contract.payload)
        ) {
          return yield* new InvalidProducerBinding({ slot, field: "job" })
        }
        // Validate only the newly applied declaration; never freeze caller-owned values.
        if (
          options === null ||
          typeof options !== "object" ||
          "defaultQueue" in options ||
          "queue" in options === "queues" in options
        ) {
          return yield* new InvalidProducerBinding({ slot, field: "queue" })
        }
        const declaredDestinations =
          "queues" in options ? options.queues : [options.queue]
        if (!Array.isArray(declaredDestinations) || declaredDestinations.length === 0) {
          return yield* new InvalidProducerBinding({ slot, field: "queue" })
        }
        const configuredDestinations = Array.from(declaredDestinations)
        if (
          configuredDestinations.some(
            (queue) => typeof queue !== "object" || queue === null
          )
        ) {
          return yield* new InvalidProducerBinding({ slot, field: "queue" })
        }
        const destinations = configuredDestinations.map((queue) =>
          Object.freeze({ ...queue })
        )
        if (
          destinations.some((queue) => !Schema.is(QueueName)(queue.name)) ||
          new Set(destinations.map((queue) => queue.name)).size !== destinations.length
        ) {
          return yield* new InvalidProducerBinding({ slot, field: "queue" })
        }
        const route =
          "queues" in options
            ? { queues: Object.freeze(destinations) }
            : { queue: destinations[0]! }
        const policy = snapshotPolicy(options.policy ?? defaultPolicy)
        if (!Schema.is(JobPolicy)(policy)) {
          return yield* new InvalidProducerBinding({ slot, field: "policy" })
        }
        // Declaration-time traversal is pure and requires no Schema encoding services.
        yield* prepareProjection(contract.payload).pipe(
          Effect.mapError(() => new InvalidProducerBinding({ slot, field: "payload" }))
        )
        return assemble(
          self.operation,
          Object.freeze({
            ...self.slots,
            [slot]: Object.freeze({
              job: contract,
              ...route,
              policy
            })
          }) as unknown as D & { readonly [K in Slot]: ResolvedBinding<Job, Route> }
        )
      })
    )

const assemble = <Operation extends string, D extends Bindings>(
  operation: Operation,
  slots: D
): JobProducer<Operation, D> => {
  const prepare = Effect.fnUntraced(function* <const K extends keyof D & string>(
    input: Input<D, K> & { readonly slot: K }
  ) {
    const slot = input.slot
    const operationId = input.operationId
    const availableAt = input.availableAt
    const payload = input.payload
    if (!Object.hasOwn(slots, slot) || typeof operationId !== "string") {
      return yield* new InvalidJobInput({ field: "producer" })
    }
    yield* validateOperationId(operationId)
    if (availableAt !== undefined && !Schema.is(EpochMillis)(availableAt)) {
      return yield* new InvalidJobInput({ field: "availableAt" })
    }
    const binding = slots[slot]!
    const destination = input.queue
    const configured = input.policy
    if (
      "queues" in binding
        ? typeof destination !== "string" ||
          !binding.queues!.some((queue) => queue.name === destination)
        : "queue" in input
    ) {
      return yield* new InvalidJobInput({ field: "catalog" })
    }
    const policy = configured === undefined ? binding.policy! : snapshotPolicy(configured)
    if (configured !== undefined && !Schema.is(JobPolicy)(policy)) {
      return yield* new InvalidJobInput({ field: "policy" })
    }
    // Capture the selected name and validated owned policy before encoding can suspend.
    const queueName = "queues" in binding ? destination! : binding.queue.name
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
        name: binding.job.name,
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
      input: Input<D, K> & { readonly slot: K }
    ) {
      const enqueueService = yield* JobEnqueue
      return yield* enqueueService
        .enqueue(prepare(input))
        .pipe(observe("enqueue", "provisional"))
    }),
    enqueueStandalone: Effect.fnUntraced(function* <const K extends keyof D & string>(
      input: Input<D, K> & { readonly slot: K }
    ) {
      const enqueueService = yield* JobEnqueue
      return yield* enqueueService
        .enqueueStandalone(prepare(input))
        .pipe(observe("enqueue-standalone", "committed"))
    }),
    enqueueInTransaction: <E, R, const K extends keyof D & string>(
      tx: JobsTransaction<E, R>,
      input: Input<D, K> & { readonly slot: K }
    ) => insertPreparing(tx, prepare(input)).pipe(observe("enqueue", "provisional"))
  })
}
