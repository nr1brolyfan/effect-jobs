// @effect-diagnostics unstableApiUsage:off
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import * as Worker from "effect-jobs/JobWorker"
import * as Registry from "effect-jobs/JobRegistry"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { CommandPersistence } from "../persistence/commands/Transactions.js"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
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
      (SELECT min(next_generation_at) FROM ${t.sandboxes} WHERE expires_at>t.now AND viewer_until>t.now AND retained_jobs<100) AS generate FROM t`,
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

// One deterministic generator request per event, capped by retained quota and DB-time viewer authority.
// Only the communications DO generates; all DOs drain their own fixed queue.
export const generate = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const persistence = yield* CommandPersistence
    const t = Tables.relations(schema)
    const rows = yield* sql.unsafe<
      Record<string, unknown>
    >(`SELECT *,floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now FROM ${t.sandboxes}
    WHERE expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND viewer_until>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND next_generation_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint AND retained_jobs<100 ORDER BY sandbox_id LIMIT 1`)
    if (!rows[0]) {
      return
    }
    const row = rows[0]
    const sandbox = yield* Schema.decodeUnknownEffect(SandboxView)({
      ref: { sandboxId: row.sandbox_id, generation: Number(row.generation) },
      expiresAt: Number(row.expires_at),
      capabilities: {
        runScenario: true,
        resetSandbox: true,
        retryJob: false,
        redriveJob: false,
        cancelJob: false
      }
    })
    const result = yield* persistence.run(
      { sandbox },
      {
        sandbox: sandbox.ref,
        requestId: `auto-${String(row.next_generation_at)}`,
        scenario: "success",
        count: 1
      }
    )
    // Advance even Unknown: read-only exact receipt is available; never authorize write replay.
    yield* sql.unsafe(
      `UPDATE ${t.sandboxes} SET next_generation_at=GREATEST(next_generation_at+5000,$3::bigint+5000)
    WHERE sandbox_id=$1 AND generation=$2 AND next_generation_at=$4 AND viewer_until>$3::bigint AND expires_at>$3::bigint`,
      [sandbox.ref.sandboxId, sandbox.ref.generation, row.now, row.next_generation_at]
    )
    return result
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
