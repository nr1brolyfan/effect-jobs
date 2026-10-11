import { Clock, Context, Effect, Schema } from "effect"
import type { JobConsumer } from "effect-jobs/JobConsumer"
import * as JobWorkerRuntime from "effect-jobs/JobWorkerRuntime"

const Delay = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 3_600_000 }))
)

/** Relative delays calculated from one PostgreSQL-time snapshot, never host-time leases.
 * The application adapter must scope reads to the authorized queue/shard and generation.
 */
export const WakeSnapshot = Schema.Struct({
  expiresInMillis: Delay,
  dueInMillis: Schema.NullOr(Delay),
  recoveryInMillis: Schema.NullOr(Delay)
})
export type WakeSnapshot = typeof WakeSnapshot.Type

export class WakeUnavailable extends Schema.TaggedError<WakeUnavailable>()(
  "WakeUnavailable",
  {}
) {}

export class WakeSchedule extends Context.Service<
  WakeSchedule,
  {
    readonly read: Effect.Effect<WakeSnapshot, WakeUnavailable>
  }
>()("playground/cloudflare/WakeSchedule") {}

/** Sole alarm owner. Native storage methods are adapted at the Cloudflare FFI boundary. */
export class WakeAlarm extends Context.Service<
  WakeAlarm,
  {
    readonly set: (epochMillis: number) => Effect.Effect<void, WakeUnavailable>
    readonly clear: Effect.Effect<void, WakeUnavailable>
  }
>()("playground/cloudflare/WakeAlarm") {}

export const limits = Object.freeze({
  cycleMillis: 5_000,
  backlogMillis: 100,
  backoffMillis: 1_000,
  repairMillis: 30_000,
  claimLimit: 10,
  recoveryLimit: 10,
  concurrency: 2
})

/** One awaited drain per event. Caller owns event serialization and scoped client lifetime.
 * Repair alarms exist only within a finite activation. Idle is not proof no delayed job exists.
 * Prearming before drain preserves a repair hint on interruption/failure, without claiming rollback.
 */
export const run = (consumer: JobConsumer) =>
  Effect.gen(function* () {
    if (
      consumer.claimLimitPerRun > limits.claimLimit ||
      consumer.recoveryLimitPerRun > limits.recoveryLimit ||
      consumer.localConcurrency > limits.concurrency
    ) {
      return yield* new WakeUnavailable()
    }
    const schedule = yield* WakeSchedule
    const alarm = yield* WakeAlarm
    const read = schedule.read.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(WakeSnapshot, { onExcessProperty: "error" })
      ),
      Effect.mapError(() => new WakeUnavailable())
    )
    const initial = yield* read
    if (initial.expiresInMillis === 0) {
      yield* alarm.clear
      return { _tag: "Expired" as const }
    }
    const started = yield* Clock.currentTimeMillis
    yield* alarm.set(started + Math.min(initial.expiresInMillis, limits.repairMillis))
    const result = yield* JobWorkerRuntime.drain(consumer).pipe(
      Effect.timeout(limits.cycleMillis),
      Effect.mapError(() => new WakeUnavailable())
    )
    const current = yield* read
    if (current.expiresInMillis === 0) {
      yield* alarm.clear
      return { _tag: "Expired" as const }
    }
    const delay =
      result._tag === "Backoff"
        ? Math.min(current.expiresInMillis, limits.backoffMillis)
        : Math.min(
            current.expiresInMillis,
            limits.repairMillis,
            current.dueInMillis ?? limits.repairMillis,
            current.recoveryInMillis ?? limits.repairMillis,
            result._tag === "MoreWork" ? limits.backlogMillis : limits.repairMillis
          )
    const now = yield* Clock.currentTimeMillis
    // Cloudflare alarms are hints. A small floor avoids an immediate hot alarm loop.
    yield* alarm.set(now + Math.max(limits.backlogMillis, delay))
    return result
  }).pipe(
    Effect.timeout(limits.cycleMillis),
    Effect.mapError(() => new WakeUnavailable())
  )
