/** Producer assertions without a database, worker or test runner. */
import { Context, Effect, Layer, Schema } from "effect"
import { EnqueueResult } from "./JobContract.js"
import type {
  EncodedJobPayload,
  JobPayloadCodecError,
  PreparedJob
} from "./JobContract.js"
import { JobEnqueue, JobPersistenceError } from "./JobEnqueue.js"
import { JobId } from "./JobId.js"
import { JobPolicy } from "./JobPolicy.js"
import type { JobDefinition } from "./Job.js"
import { decodeJobPayload } from "./JobPayloadCodec.js"

/** Prepared request metadata. The synthetic job ID is local to this recorder. */
export interface RecordedEnqueue extends Omit<PreparedJob, "encoded"> {
  readonly jobId: JobId
  readonly mode: "joined" | "standalone"
}

interface Capture {
  readonly request: RecordedEnqueue
  readonly encoded: EncodedJobPayload
}

/** A recorded request with its payload decoded by the supplied job definition. */
export interface DecodedEnqueue<Payload> extends RecordedEnqueue {
  readonly payload: Payload
}

/** Test-only inspection service; install it with `layer`. */
export class EnqueueRecorder extends Context.Service<
  EnqueueRecorder,
  {
    readonly enqueued: Effect.Effect<ReadonlyArray<RecordedEnqueue>>
    readonly enqueuedOf: <S extends Schema.Top>(
      job: JobDefinition<S>
    ) => Effect.Effect<
      ReadonlyArray<DecodedEnqueue<S["Type"]>>,
      JobPayloadCodecError,
      S["DecodingServices"]
    >
  }
>()("effect-jobs/testing/EnqueueRecorder") {}

const JoinedEnqueue = Context.Reference("effect-jobs/testing/JoinedEnqueue", {
  defaultValue: (): boolean => false
})
const decodeId = Schema.decodeSync(JobId)
const decodePolicy = Schema.decodeEffect(JobPolicy, { onExcessProperty: "ignore" })

/** Mark this test Effect as a joined enqueue scope. Does not begin a transaction. */
export const withJoinedEnqueue = Effect.provideService(JoinedEnqueue, true)

/** Fresh recorder per Layer build. Runs normal producer preparation, but never
 * persists, deduplicates, runs a handler or models commit/rollback. Only
 * `JobEnqueue` paths are captured, not explicit `JobsTransaction` calls.
 */
export const layer = Layer.effectContext(
  Effect.sync(() => {
    const captures: Array<Capture> = []
    const record = Effect.fnUntraced(function* <E, R>(
      mode: RecordedEnqueue["mode"],
      prepare: Effect.Effect<PreparedJob, E, R>
    ) {
      const joined = yield* JoinedEnqueue
      if (joined !== (mode === "joined")) {
        return yield* new JobPersistenceError({
          reason: joined ? "active-transaction" : "transaction-required",
          commitKnowledge: "NotCommitted"
        })
      }
      const { encoded, policy, ...metadata } = yield* prepare
      const snapshot = yield* decodePolicy(policy).pipe(
        Effect.mapError(
          () =>
            new JobPersistenceError({
              reason: "storage-failure",
              commitKnowledge: "NotCommitted"
            })
        )
      )
      return yield* Effect.sync(() => {
        const jobId = decodeId(`recorded-${captures.length + 1}`)
        captures.push({
          request: Object.freeze({
            ...metadata,
            policy: Object.freeze({
              ...snapshot,
              retrySchedule: Object.freeze(snapshot.retrySchedule),
              completedRetention: Object.freeze(snapshot.completedRetention),
              deadRetention: Object.freeze(snapshot.deadRetention)
            }),
            jobId,
            mode
          }),
          encoded: {
            formatVersion: encoded.formatVersion,
            payloadBytes: new Uint8Array(encoded.payloadBytes),
            semanticProjectionBytes: new Uint8Array(encoded.semanticProjectionBytes)
          }
        })
        return EnqueueResult.Inserted({ jobId })
      })
    })
    return Context.make(
      EnqueueRecorder,
      EnqueueRecorder.of({
        enqueued: Effect.sync(() => captures.map((capture) => capture.request)),
        enqueuedOf: Effect.fnUntraced(function* <S extends Schema.Top>(
          job: JobDefinition<S>
        ) {
          const matches = captures.filter(
            (capture) =>
              capture.request.catalog.name === job.name &&
              capture.request.catalog.version === job.version
          )
          return yield* Effect.forEach(matches, (capture) =>
            decodeJobPayload(job.payload, capture.encoded).pipe(
              Effect.map((payload) => ({ ...capture.request, payload }))
            )
          )
        })
      })
    ).pipe(
      Context.add(
        JobEnqueue,
        JobEnqueue.of({
          enqueue: (prepare) => record("joined", prepare),
          enqueueStandalone: (prepare) => record("standalone", prepare)
        })
      )
    )
  })
)

/** Requests recorded after successful preparation, in recording order. */
export const enqueued = EnqueueRecorder.use((recorder) => recorder.enqueued)

/** Match a job name and version across queues. Decode with its payload Schema
 * and retain the Schema's decoding service requirements.
 */
export const enqueuedOf = <S extends Schema.Top>(job: JobDefinition<S>) =>
  EnqueueRecorder.use((recorder) => recorder.enqueuedOf(job))
