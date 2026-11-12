/** Explicit read-only wake hints. No alarms, polling or execution start on import. */
import { Cause, Context, Data, Effect, Layer, Schema } from "effect"
import { BatchLimit } from "./JobLifecycle.js"
import { EpochMillis } from "./JobPolicy.js"
import type { JobGroup, Definitions } from "./JobGroup.js"
import type { CatalogIdentity } from "./JobIdentity.js"
import type { JobQueue } from "./JobQueue.js"

/** Invalid observation request or malformed storage metadata; never includes row values. */
export class JobScheduleProtocolError extends Data.TaggedError(
  "JobScheduleProtocolError"
)<{
  readonly reason: "invalid-input" | "invalid-observation"
}> {}

/** Safe source failure; no provider diagnostics or database parameters are retained. */
export class JobScheduleUnavailable extends Data.TaggedError(
  "JobScheduleUnavailable"
)<{}> {}

/** One queue and at most 500 supported contracts; limit is an integer in 1–500. */
export interface Request {
  readonly queue: string
  readonly supportedCatalog: ReadonlyArray<CatalogIdentity>
  readonly limit: number
}

/** The earliest supported availability in a bounded queue head and earliest active lease.
 * Null availability with saturated=true is inconclusive, not an empty queue.
 * Subtract observedAt from timestamps for delays; never treat process time as DB time.
 */
export type Observation = typeof Observation.Type
/** Runtime observation contract. Past timestamps are due; no lifecycle state is changed. */
export const Observation = Schema.Struct({
  observedAt: EpochMillis,
  nextAvailableAt: EpochMillis.pipe(Schema.NullOr),
  nextRecoveryAt: EpochMillis.pipe(Schema.NullOr),
  saturated: Schema.Boolean
})

/** Qualified read-only source. Validate requests before queries, snapshot their selection,
 * return only bounded metadata from one authoritative-clock observation, and never lock,
 * claim, recover or modify jobs. Source acquisition/query/release must be finitely bounded.
 * Saturation reports an incomplete pending/retry sample, not an exact queue count.
 */
export interface Reader<E = never, R = never> {
  readonly read: (
    request: Request
  ) => Effect.Effect<Observation, E | JobScheduleProtocolError, R>
}

/** Captured safe observation service; independent of handler installation and workers. */
export type JobScheduleService = Reader<JobScheduleUnavailable>

/** Application-selected observation source, provided separately from execution storage. */
export class JobSchedule extends Context.Service<JobSchedule, JobScheduleService>()(
  "effect-jobs/JobSchedule"
) {}

/** Capture source requirements without performing reads or owning its resource lifetime. */
export const make = <E, R>(source: Reader<E, R>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<R>()
    return Object.freeze(
      JobSchedule.of({
        read: (request) =>
          Effect.suspend(() => source.read(request)).pipe(
            Effect.provide(services),
            Effect.catchCause((cause) =>
              Effect.failCause(
                Cause.map(cause, (error) =>
                  error instanceof JobScheduleProtocolError
                    ? error
                    : new JobScheduleUnavailable()
                )
              )
            )
          )
      })
    )
  })

/** Provide an explicit observation source. No polling, alarms or migrations are installed. */
export const layer = <E, R>(source: Reader<E, R>) =>
  Layer.effect(JobSchedule, make(source))

/** Per-observation metadata sample size; defaults to 100, maximum 500. */
export interface Options {
  readonly limit?: number
}
const OptionsSchema = Schema.Struct({ limit: BatchLimit.pipe(Schema.optionalKey) })

/**
 * Observe the selected group's contracts in one queue, without requiring handlers.
 * Recovery is queue-scoped, including expired leases for other contracts, just like drain.
 * Hints can become stale immediately after reading. Keep a finite repair wakeup even
 * when timestamps are null; saturated samples especially cannot establish emptiness.
 * The application owns authorization, activation expiry and exclusive alarm ownership.
 */
export const observe = <Name extends string, D extends Definitions>(
  group: JobGroup<Name, D>,
  queue: JobQueue,
  options: Options = {}
) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeEffect(OptionsSchema)(options, {
      onExcessProperty: "error"
    }).pipe(
      Effect.mapError(() => new JobScheduleProtocolError({ reason: "invalid-input" }))
    )
    const source = yield* JobSchedule
    return yield* source.read({
      queue: queue.name,
      supportedCatalog: Object.values(group.definitions).map((job) => ({
        queue: queue.name,
        name: job.name,
        version: job.version
      })),
      limit: decoded.limit ?? 100
    })
  })
