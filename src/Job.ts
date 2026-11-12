/**
 * Defines versioned jobs with transaction-bound production and Layer-installed handlers.
 */
import { Data, Effect, Layer, Schema } from "effect"
import { InvalidJobInput } from "./JobContract.js"
import type {
  EnqueueInput,
  EnqueueResult,
  HandlerInput,
  JobPayloadDecoder,
  JobPayloadEncoder
} from "./JobContract.js"
import type { JobFailure } from "./JobFailure.js"
import { CatalogIdentity, ProducerIdentity } from "./JobIdentity.js"
import type { JobQueue } from "./JobQueue.js"
import { EpochMillis, PersistedJobPolicy, type JobPolicy } from "./JobPolicy.js"
import { JobRegistry, type DuplicateJobHandler } from "./JobRegistry.js"
import type { JobEnqueueError, JobsTransaction } from "./JobTransaction.js"
import { encodeJobPayload } from "./JobPayloadCodec.js"
import { JobEnqueue, type JobBackendError } from "./JobEnqueue.js"
import { insertPrepared } from "./internal/JobTransaction.js"

/**
 * Typed construction failure for invalid catalog identity, payload Schema or default policy.
 *
 * @category errors
 */
export class InvalidJobDefinition extends Data.TaggedError("InvalidJobDefinition")<{
  readonly expected: string
}> {}

/**
 * Immutable job declaration. Payload carries decoded data and its Schema service requirements.
 *
 * @category models
 */
export interface JobDefinition<
  Payload extends Schema.Top = Schema.Top,
  Name extends string = string,
  Version extends number = number,
  Queue extends string = string,
  Default extends JobPolicy | undefined = JobPolicy | undefined
> {
  readonly name: Name
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy: Default
  readonly catalog: CatalogIdentity<Queue, Name, Version>
  /** Enqueues in the active configured backend transaction; runs no commit or replay.
   * Same producer tuple compares catalog and semantic payload, returning the first ID
   * for a match or JobIntegrityConflict for changed content. Results are provisional
   * until outer commit; encoding services and backend E/R remain explicit. */
  readonly enqueue: (
    input: EnqueueInput<Payload["Type"], Default>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | Payload["EncodingServices"]
  >
  /** Owns an atomic transaction; rejects an active configured-client transaction.
   * Success follows acknowledged commit; uncertain outcomes stay unknown. */
  readonly enqueueStandalone: (
    input: EnqueueInput<Payload["Type"], Default>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | Payload["EncodingServices"]
  >
  /** Explicit invocation-scoped primitive for qualified custom adapters. */
  readonly enqueueInTransaction: <E, R>(
    tx: JobsTransaction<E, R>,
    input: EnqueueInput<Payload["Type"], Default>
  ) => Effect.Effect<EnqueueResult, E | JobEnqueueError, R | Payload["EncodingServices"]>
  /** Installs one decoder/handler in JobRegistry and captures its Effect services.
   * Requires JobRegistry plus decoding and execute requirements; duplicate installation
   * fails with DuplicateJobHandler. Receives payload/context, with no SQL authority. */
  readonly handlerLayer: <R>(
    execute: (input: HandlerInput<Payload["Type"]>) => Effect.Effect<void, JobFailure, R>,
    decodePayload: JobPayloadDecoder
  ) => Layer.Layer<
    never,
    DuplicateJobHandler,
    JobRegistry | R | Payload["DecodingServices"]
  >
}

/**
 * Creates a frozen definition lazily; invalid declarations fail with InvalidJobDefinition.
 * Each execution snapshots configuration and creates an independently owned definition.
 * Omitted version is exactly 1; the standard payload encoder is the default.
 * An explicit encoder overrides it. Enqueue requires the Schema's encoding
 * services; handler installation captures decoding and execution services.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Job from "effect-jobs/Job"
 * import * as Queue from "effect-jobs/JobQueue"
 * import * as Codec from "effect-jobs/JobPayloadCodec"
 *
 * const setup = Effect.gen(function* () {
 *   const definition = yield* Job.make({
 *     queue: Queue.make("billing"),
 *     name: "invoice.generate",
 *     payload: Schema.Struct({ invoiceId: Schema.String })
 *   })
 *   // Provide JobRegistry when building this Layer. Add application services as needed.
 *   // Replace this no-op with an idempotent application handler.
 *   const handler = definition.handlerLayer(() => Effect.void, Codec.decodeJobPayload)
 *   return { definition, handler }
 * })
 * ```
 *
 * @category constructors
 */
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string,
  const Version extends number
>(options: {
  readonly name: Name
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy: JobPolicy
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, Version, Queue, JobPolicy>,
  InvalidJobDefinition
>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string
>(options: {
  readonly name: Name
  readonly version?: undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy: JobPolicy
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<JobDefinition<Payload, Name, 1, Queue, JobPolicy>, InvalidJobDefinition>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string,
  const Version extends number = 1
>(options: {
  readonly name: Name
  readonly version?: Version | undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy: JobPolicy
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, Version | 1, Queue, JobPolicy>,
  InvalidJobDefinition
>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string,
  const Version extends number
>(options: {
  readonly name: Name
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy?: JobPolicy | undefined
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, Version, Queue, JobPolicy | undefined>,
  InvalidJobDefinition
>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string
>(options: {
  readonly name: Name
  readonly version?: undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy?: JobPolicy | undefined
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, 1, Queue, JobPolicy | undefined>,
  InvalidJobDefinition
>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Queue extends string,
  const Version extends number = 1
>(options: {
  readonly name: Name
  readonly version?: Version | undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy?: JobPolicy | undefined
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, Version | 1, Queue, JobPolicy | undefined>,
  InvalidJobDefinition
>
export function make<
  Payload extends Schema.Top,
  Name extends string,
  Queue extends string,
  Version extends number
>(options: {
  readonly name: Name
  readonly version?: Version | undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly defaultPolicy?: JobPolicy | undefined
  readonly encodePayload?: JobPayloadEncoder
}): Effect.Effect<
  JobDefinition<Payload, Name, Version | 1, Queue, JobPolicy | undefined>,
  InvalidJobDefinition
> {
  return Effect.gen(function* () {
    const {
      name,
      queue,
      payload,
      version: configuredVersion,
      defaultPolicy: configuredPolicy,
      encodePayload: configuredEncoder
    } = options
    const version = configuredVersion === undefined ? 1 : configuredVersion
    const encodePayload = configuredEncoder ?? encodeJobPayload
    const catalog = Object.freeze({ queue: queue.name, name, version })
    if (!Schema.is(CatalogIdentity)(catalog) || !Schema.isSchema(payload)) {
      return yield* new InvalidJobDefinition({
        expected: "valid queue/name/version and payload Schema"
      })
    }
    if (
      configuredPolicy !== undefined &&
      !Schema.is(PersistedJobPolicy)(configuredPolicy)
    ) {
      return yield* new InvalidJobDefinition({ expected: "complete valid defaultPolicy" })
    }
    const snapshotPolicy = (policy: JobPolicy): JobPolicy =>
      Object.freeze({
        ...policy,
        retrySchedule: Object.freeze({ ...policy.retrySchedule }),
        completedRetention: Object.freeze({ ...policy.completedRetention }),
        deadRetention: Object.freeze({ ...policy.deadRetention })
      })
    const defaultPolicy =
      configuredPolicy === undefined ? undefined : snapshotPolicy(configuredPolicy)
    const prepare = Effect.fnUntraced(function* (
      input: EnqueueInput<Payload["Type"], JobPolicy>
    ) {
      if (!Schema.is(ProducerIdentity)(input.producer)) {
        return yield* new InvalidJobInput({ field: "producer" })
      }
      const selectedPolicy = input.policy === undefined ? defaultPolicy : input.policy
      if (!Schema.is(PersistedJobPolicy)(selectedPolicy)) {
        return yield* new InvalidJobInput({ field: "policy" })
      }
      if (input.availableAt !== undefined && !Schema.is(EpochMillis)(input.availableAt)) {
        return yield* new InvalidJobInput({ field: "availableAt" })
      }
      const producer = Object.freeze({
        operation: input.producer.operation,
        operationId: input.producer.operationId,
        slot: input.producer.slot
      })
      const policy = snapshotPolicy(selectedPolicy)
      const availableAt = input.availableAt
      const encoded = yield* encodePayload(payload, input.payload)
      return Object.freeze({
        catalog,
        producer,
        policy,
        encoded,
        ...(availableAt === undefined ? {} : { availableAt })
      })
    })
    return Object.freeze({
      name,
      version,
      queue,
      payload,
      defaultPolicy,
      catalog,
      enqueue: Effect.fnUntraced(function* (
        input: EnqueueInput<Payload["Type"], JobPolicy>
      ) {
        const backend = yield* JobEnqueue
        // Check transaction presence before potentially asynchronous encryption.
        return yield* backend.enqueue(prepare(input))
      }),
      enqueueStandalone: Effect.fnUntraced(function* (
        input: EnqueueInput<Payload["Type"], JobPolicy>
      ) {
        const backend = yield* JobEnqueue
        return yield* backend.enqueueStandalone(prepare(input))
      }),
      enqueueInTransaction: Effect.fnUntraced(function* <E, R>(
        tx: JobsTransaction<E, R>,
        input: EnqueueInput<Payload["Type"], JobPolicy>
      ) {
        return yield* insertPrepared(tx, yield* prepare(input))
      }),
      handlerLayer: <R>(
        execute: (
          input: HandlerInput<Payload["Type"]>
        ) => Effect.Effect<void, JobFailure, R>,
        decodePayload: JobPayloadDecoder
      ) =>
        Layer.effectDiscard(
          Effect.gen(function* () {
            const registry = yield* JobRegistry
            const services = yield* Effect.context<R | Payload["DecodingServices"]>()
            yield* registry.install({
              catalog,
              execute: (encoded, context) =>
                Effect.flatMap(decodePayload(payload, encoded), (decoded) =>
                  Effect.suspend(() => execute({ payload: decoded, context }))
                ).pipe(Effect.provide(services))
            })
          })
        )
    })
  })
}
