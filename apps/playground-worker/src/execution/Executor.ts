// @effect-diagnostics unstableApiUsage:off
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import * as Worker from "effect-jobs/JobWorker"
import * as Registry from "effect-jobs/JobRegistry"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Traffic from "../scenarios/PrivateTraffic.js"
import * as Definitions from "../scenarios/Definitions.js"
import * as Handlers from "../scenarios/Handlers.js"
import * as Provider from "./PostgreSqlProvider.js"
import * as Tables from "../persistence/authority/Schema.js"
import { WakeAlarm } from "../cloudflare/WakeCycle.js"

export const limits = Object.freeze({
  cycleMillis: 5000,
  generationMillis: 5000,
  repairMillis: 5000,
  claimLimit: 10,
  recoveryLimit: 10,
  concurrency: 2
})
// Four fixed application queue identities, independent of sandbox/job cardinality.
export const queueNames = [
  "playground-communications",
  "playground-media",
  "playground-commerce",
  "playground-private"
] as const
export type QueueName = (typeof queueNames)[number]
export class ExecutionHints extends Context.Service<
  ExecutionHints,
  {
    // Internal invalidation only; adapter reconciles authoritative scoped reads.
    readonly reconcile: Effect.Effect<void>
  }
>()("playground/ExecutionHints") {}
export class ExecutionDeadline extends Schema.TaggedError<ExecutionDeadline>()(
  "ExecutionDeadline",
  {}
) {}

export const consumers = Effect.forEach(queueNames, (name) =>
  Consumer.make(
    Definitions.definitions.find((definition) => definition.queue.name === name)!.queue,
    {
      localConcurrency: limits.concurrency,
      claimLimitPerRun: limits.claimLimit,
      recoveryLimitPerRun: limits.recoveryLimit
    }
  )
)
export const workerLayerNoDeps = (schema: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const backend = yield* PostgreSqlJobs
      return Worker.layer(backend.store, {
        catalog: Definitions.definitions,
        operationResponseBudgetMillis: 500
      }).pipe(
        Layer.provide(Handlers.layerNoDeps),
        Layer.provide(Registry.layer),
        Layer.provide(Provider.layerNoDeps(schema))
      )
    })
  )

export const snapshot = (schema: string, queue: QueueName) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = Tables.relations(schema)
    const [row] = yield* sql.unsafe<{
      now: string
      active_until: string | null
      due: string | null
      recovery: string | null
      generate: string | null
    }>(
      `WITH t AS MATERIALIZED (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now)
    SELECT t.now,
      (SELECT max(LEAST(expires_at,viewer_until)) FROM ${t.sandboxes} WHERE expires_at>t.now AND viewer_until>t.now) AS active_until,
      (SELECT min(j.available_at) FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id JOIN ${t.sandboxes} s ON s.sandbox_id=a.sandbox_id
        WHERE j.queue=$1 AND j.state IN ('Pending','RetryScheduled') AND a.generation=s.generation AND s.expires_at>t.now AND s.viewer_until>t.now) AS due,
      (SELECT min(lease_expires_at) FROM ${t.jobs} WHERE queue=$1 AND state='Active') AS recovery,
       (SELECT min(s.next_generation_at) FROM ${t.sandboxes} s WHERE NOT s.demo_owned AND s.expires_at>t.now AND s.viewer_until>t.now AND s.retained_jobs<100 AND (SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)<200) AS generate FROM t`,
      [queue]
    )
    const now = Number(row!.now)
    return {
      activeMillis:
        row!.active_until === null ? 0 : Math.max(0, Number(row!.active_until) - now),
      nextMillis: Math.max(
        0,
        Math.min(
          limits.repairMillis,
          ...[row!.due, row!.recovery, row!.generate]
            .filter((n) => n !== null)
            .map((n) => Number(n) - now)
        )
      )
    }
  })

// One mixed arrival per event. Selection, receipt, quota and schedule share the native transaction.
// Unknown COMMIT is resolved by the next authoritative row/receipt read, never a client replay.
export const generate = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const backend = yield* PostgreSqlJobs
    const traffic = yield* Traffic.make(schema).pipe(
      Effect.provideService(JobEnqueue, backend.producer)
    )
    const t = Tables.relations(schema)
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql.unsafe<
          Record<string, unknown>
        >(`SELECT s.* FROM ${t.sandboxes} s
      WHERE NOT demo_owned AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND viewer_until>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND next_generation_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint AND retained_jobs<100 AND (SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)<200
      ORDER BY next_generation_at,sandbox_id LIMIT 1 FOR UPDATE SKIP LOCKED`)
        const row = rows[0]
        if (!row) {
          return
        }
        const [clock] = yield* sql.unsafe<{ now: string }>(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
        )
        const now = Number(clock!.now)
        if (Number(row.viewer_until) <= now || Number(row.expires_at) <= now) {
          return
        }
        const ref = yield* Schema.decodeUnknownEffect(SandboxRef)({
          sandboxId: row.sandbox_id,
          generation: Number(row.generation)
        })
        const sequence = Number(row.retained_jobs)
        yield* traffic.append(
          ref,
          `auto-${String(row.next_generation_at)}`,
          [Traffic.profile(sequence)],
          now,
          sequence
        )
        yield* sql.unsafe(
          `UPDATE ${t.sandboxes} SET next_generation_at=$3::bigint+5000 WHERE sandbox_id=$1 AND generation=$2`,
          [ref.sandboxId, ref.generation, now]
        )
      })
    )
  })

// Caller serializes native DO events and owns one event Scope/PgClient lifetime.
// Alarm prearm is a repair hint; failure/interrupt never implies rollback or cancellation.
export const run = (schema: string, queue: QueueName) =>
  Effect.gen(function* () {
    const alarm = yield* WakeAlarm
    const hints = yield* ExecutionHints
    const before = yield* snapshot(schema, queue)
    if (before.activeMillis === 0) {
      yield* alarm.clear
      return { _tag: "Retired" as const }
    }
    const now = yield* Clock.currentTimeMillis
    yield* alarm.set(now + Math.min(before.activeMillis, limits.repairMillis))
    if (queue === "playground-communications") {
      yield* generate(schema).pipe(
        Effect.catchTag("PlaygroundError", (error) =>
          ["sandbox-expired", "stale-generation", "limit-reached"].includes(error.code)
            ? Effect.void
            : Effect.fail(error)
        )
      )
    }
    const plans = yield* consumers
    const consumer = plans.find((plan) => plan.queue.name === queue)!
    const result = yield* Runtime.drain(consumer)
    yield* hints.reconcile
    const after = yield* snapshot(schema, queue)
    if (after.activeMillis === 0) {
      yield* alarm.clear
      return { _tag: "Retired" as const }
    }
    const at = yield* Clock.currentTimeMillis
    yield* alarm.set(
      at +
        Math.max(
          100,
          Math.min(
            after.activeMillis,
            result._tag === "MoreWork"
              ? 100
              : result._tag === "Backoff"
                ? 1000
                : after.nextMillis,
            limits.repairMillis
          )
        )
    )
    return result
  }).pipe(
    Effect.timeoutOrElse({
      duration: limits.cycleMillis,
      orElse: () => Effect.fail(new ExecutionDeadline())
    })
  )
