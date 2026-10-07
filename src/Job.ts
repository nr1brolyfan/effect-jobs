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
import { EpochMillis, PersistedJobPolicy } from "./JobPolicy.js"
import { JobRegistry, type DuplicateJobHandler } from "./JobRegistry.js"
import type { JobEnqueueError, JobsTransaction } from "./JobTransaction.js"
import { encodeJobPayload } from "./JobPayloadCodec.js"
import { JobEnqueue, type JobBackendError } from "./JobEnqueue.js"
import { insertPrepared } from "./internal/JobTransaction.js"

/**
 * Thrown synchronously for an invalid catalog identity or payload Schema.
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
  Kind extends string = string,
  Version extends number = number,
  Queue extends string = string
> {
  readonly kind: Kind
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly catalog: CatalogIdentity<Queue, Kind, Version>
  /** Enqueues in the active configured backend transaction; runs no commit or replay.
   * Same producer tuple compares catalog and semantic payload, returning the first ID
   * for a match or JobIntegrityConflict for changed content. Results are provisional
   * until outer commit; encoding services and backend E/R remain explicit. */
  readonly enqueue: (
    input: EnqueueInput<Payload["Type"]>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | Payload["EncodingServices"]
  >
  /** Owns an atomic transaction; rejects an active configured-client transaction.
   * Success follows acknowledged commit; uncertain outcomes stay unknown. */
  readonly enqueueStandalone: (
    input: EnqueueInput<Payload["Type"]>
  ) => Effect.Effect<
    EnqueueResult,
    JobEnqueueError | JobBackendError,
    JobEnqueue | Payload["EncodingServices"]
  >
  /** Explicit invocation-scoped primitive for qualified custom adapters. */
  readonly enqueueInTransaction: <E, R>(
    tx: JobsTransaction<E, R>,
    input: EnqueueInput<Payload["Type"]>
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
 * Creates a frozen definition; throws InvalidJobDefinition for invalid declarations.
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
 * const definition = Job.make({
 *   queue: Queue.make("billing"),
 *   kind: "invoice.generate",
 *   payload: Schema.Struct({ invoiceId: Schema.String })
 * })
 * // Provide JobRegistry when building this Layer. Add application services as needed.
 * // Replace this no-op with an idempotent application handler.
 * const HandlerLayer = definition.handlerLayer(
 *   ({ payload, context }) => Effect.void,
 *   Codec.decodeJobPayload
 * )
 * ```
 *
 * @category constructors
 */
export function make<
  Payload extends Schema.Top,
  const Kind extends string,
  const Queue extends string,
  const Version extends number
>(options: {
  readonly kind: Kind
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly encodePayload?: JobPayloadEncoder
}): JobDefinition<Payload, Kind, Version, Queue>
export function make<
  Payload extends Schema.Top,
  const Kind extends string,
  const Queue extends string
>(options: {
  readonly kind: Kind
  readonly version?: undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly encodePayload?: JobPayloadEncoder
}): JobDefinition<Payload, Kind, 1, Queue>
export function make<
  Payload extends Schema.Top,
  const Kind extends string,
  const Queue extends string,
  const Version extends number = 1
>(options: {
  readonly kind: Kind
  readonly version?: Version | undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly encodePayload?: JobPayloadEncoder
}): JobDefinition<Payload, Kind, Version | 1, Queue>
export function make<
  Payload extends Schema.Top,
  Kind extends string,
  Queue extends string,
  Version extends number
>(options: {
  readonly kind: Kind
  readonly version?: Version | undefined
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly encodePayload?: JobPayloadEncoder
}): JobDefinition<Payload, Kind, Version | 1, Queue> {
  const { kind, queue, payload } = options
  const version = options.version === undefined ? 1 : options.version
  const encodePayload = options.encodePayload ?? encodeJobPayload
  const catalog = Object.freeze({ queue: queue.name, kind, version })
  if (!Schema.is(CatalogIdentity)(catalog) || !Schema.isSchema(payload)) {
    throw new InvalidJobDefinition({
      expected: "valid queue/kind/version and payload Schema"
    })
  }
  const prepare = Effect.fnUntraced(function* (input: EnqueueInput<Payload["Type"]>) {
    if (!Schema.is(ProducerIdentity)(input.producer)) {
      return yield* new InvalidJobInput({ field: "producer" })
    }
    if (!Schema.is(PersistedJobPolicy)(input.policy)) {
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
    const policy = Object.freeze({
      ...input.policy,
      retrySchedule: Object.freeze({ ...input.policy.retrySchedule }),
      completedRetention: Object.freeze({ ...input.policy.completedRetention }),
      deadRetention: Object.freeze({ ...input.policy.deadRetention })
    })
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
    kind,
    version,
    queue,
    payload,
    catalog,
    enqueue: Effect.fnUntraced(function* (input: EnqueueInput<Payload["Type"]>) {
      const backend = yield* JobEnqueue
      // Check transaction presence before potentially asynchronous encryption.
      return yield* backend.enqueue(prepare(input))
    }),
    enqueueStandalone: Effect.fnUntraced(function* (
      input: EnqueueInput<Payload["Type"]>
    ) {
      const backend = yield* JobEnqueue
      return yield* backend.enqueueStandalone(prepare(input))
    }),
    enqueueInTransaction: Effect.fnUntraced(function* <E, R>(
      tx: JobsTransaction<E, R>,
      input: EnqueueInput<Payload["Type"]>
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
}
