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
import { insertPrepared } from "./internal/JobTransaction.js"

export class InvalidJobDefinition extends Data.TaggedError("InvalidJobDefinition")<{
  readonly expected: string
}> {}

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
  readonly enqueue: <E, R>(
    tx: JobsTransaction<E, R>,
    input: EnqueueInput<Payload["Type"]>
  ) => Effect.Effect<EnqueueResult, E | JobEnqueueError, R | Payload["EncodingServices"]>
  readonly handlerLayer: <R>(
    execute: (input: HandlerInput<Payload["Type"]>) => Effect.Effect<void, JobFailure, R>,
    decodePayload: JobPayloadDecoder
  ) => Layer.Layer<
    never,
    DuplicateJobHandler,
    JobRegistry | R | Payload["DecodingServices"]
  >
}

/** Codec dependency is explicit until serial integration supplies the qualified implementation. */
export const make = <
  Payload extends Schema.Top,
  const Kind extends string,
  const Version extends number,
  const Queue extends string
>(options: {
  readonly kind: Kind
  readonly version: Version
  readonly queue: JobQueue<Queue>
  readonly payload: Payload
  readonly encodePayload: JobPayloadEncoder
}): JobDefinition<Payload, Kind, Version, Queue> => {
  const { kind, version, queue, payload, encodePayload } = options
  const catalog = Object.freeze({ queue: queue.name, kind, version })
  if (!Schema.is(CatalogIdentity)(catalog) || !Schema.isSchema(payload)) {
    throw new InvalidJobDefinition({
      expected: "valid queue/kind/version and payload Schema"
    })
  }
  return Object.freeze({
    kind,
    version,
    queue,
    payload,
    catalog,
    enqueue: Effect.fnUntraced(function* <E, R>(
      tx: JobsTransaction<E, R>,
      input: EnqueueInput<Payload["Type"]>
    ) {
      if (!Schema.is(ProducerIdentity)(input.producer)) {
        return yield* new InvalidJobInput({ field: "producer" })
      }
      if (!Schema.is(PersistedJobPolicy)(input.policy)) {
        return yield* new InvalidJobInput({ field: "policy" })
      }
      if (input.availableAt !== undefined && !Schema.is(EpochMillis)(input.availableAt)) {
        return yield* new InvalidJobInput({ field: "availableAt" })
      }
      // Snapshot configuration before asynchronous encoding; the backend owns IDs and equality.
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
      return yield* insertPrepared(
        tx,
        Object.freeze({
          catalog,
          producer,
          policy,
          encoded,
          ...(availableAt === undefined ? {} : { availableAt })
        })
      )
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
