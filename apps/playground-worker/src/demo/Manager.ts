// App-owned demo metadata/retention only. Lifecycle changes go through effect-jobs.
// @effect-diagnostics unstableApiUsage:off
import { Duration, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { SandboxRef, SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Plan from "../scenarios/Plan.js"
import * as Definitions from "../scenarios/Definitions.js"
import { relations } from "../persistence/authority/Schema.js"
import * as RepairSchema from "../persistence/commands/RepairSchema.js"
import * as Traffic from "./Traffic.js"
import * as Retry from "effect-jobs/JobRetryPolicy"

export const limits = Object.freeze({
  rotationMillis: 86_400_000,
  tickMillis: 5_000,
  seedJobs: 30,
  maxJobs: Traffic.maxRetainedJobs,
  cleanupBatch: 50
})
const clock = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint"
const capabilities = {
  runScenario: false,
  resetSandbox: false,
  retryJob: false,
  redriveJob: false,
  cancelJob: false
}

export const current = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = relations(schema)
    const [row] = yield* sql.unsafe<{
      sandbox_id: string
      generation: string
      expires_at: string
    }>(
      `SELECT s.* FROM "${schema}"."demo_control" d JOIN ${t.sandboxes} s ON s.sandbox_id=d.current_id WHERE s.demo_owned AND s.expires_at>${clock}`
    )
    if (!row) {
      return yield* new PlaygroundError({ code: "unavailable" })
    }
    // Renew executor interest independently from viewer traffic: this is a live public demo.
    yield* sql.unsafe(
      `UPDATE ${t.sandboxes} SET viewer_until=expires_at WHERE sandbox_id=$1`,
      [row.sandbox_id]
    )
    return yield* Schema.decodeUnknownEffect(SandboxView)({
      ref: { sandboxId: row.sandbox_id, generation: Number(row.generation) },
      expiresAt: Number(row.expires_at),
      capabilities
    })
  })

const seedBatch = (
  schema: string,
  id: string,
  requestId: string,
  seed: number,
  behavior: Definitions.Behavior,
  availableAt: number,
  count = 6,
  profiles?: ReadonlyArray<Traffic.Profile>
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const backend = yield* PostgreSqlJobs
    const ref = yield* Schema.decodeUnknownEffect(SandboxRef)({
      sandboxId: id,
      generation: 1
    })
    const jobs = yield* Plan.plan(
      { sandbox: ref, requestId, scenario: "success", count },
      ref,
      seed,
      availableAt
    )
    for (const job of jobs) {
      const profile = profiles?.[job.payload.sequence - 1]
      const planned = {
        ...job,
        payload: { ...job.payload, behavior: profile?.behavior ?? behavior },
        availableAt: availableAt + (profile?.waitMillis ?? 0),
        policy: yield* JobPolicy.make({
          retry: Retry.fixed(Duration.millis(profile?.retryMillis ?? 60_000))
        })
      }
      const result = yield* Plan.enqueue(planned).pipe(
        Effect.provideService(JobEnqueue, backend.producer)
      )
      yield* sql.unsafe(
        `INSERT INTO ${relations(schema).associations} VALUES($1,1,$2,$3::jsonb)`,
        [
          id,
          result.jobId,
          JSON.stringify({
            syntheticActor: job.payload.actor,
            syntheticOrderId: job.payload.order
          })
        ]
      )
    }
    yield* sql.unsafe(
      `UPDATE ${relations(schema).sandboxes} SET retained_jobs=retained_jobs+$2 WHERE sandbox_id=$1`,
      [id, count]
    )
  })

export const tick = (schema: string, rotationMillis: number = limits.rotationMillis) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = relations(schema)
    const control = `"${schema}"."demo_control"`
    // Persisted control row serializes retries/restarts and makes seed/switch atomic.
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [d] = yield* sql.unsafe<{
          current_id: string | null
          candidate_id: string | null
          rotate_at: string
          next_tick: string
          sequence: string
        }>(`SELECT * FROM ${control} WHERE singleton FOR UPDATE`)
        const [time] = yield* sql.unsafe<{ now: string }>(`SELECT ${clock} AS now`)
        const now = Number(time!.now)
        // Resume after a prolonged outage without abandoning expired demo work.
        // Private sandbox lifetimes are never extended by the generator.
        yield* sql.unsafe(
          `UPDATE ${t.sandboxes} SET expires_at=GREATEST(expires_at,$1::bigint),viewer_until=GREATEST(expires_at,$1::bigint) WHERE demo_owned`,
          [now + 600_000]
        )
        // Only terminal, retired, demo-owned jobs may be removed. Never discard a lease,
        // pending work, public current/candidate data, or private visitor data.
        const retired = yield* sql.unsafe<{ sandbox_id: string }>(
          `SELECT sandbox_id FROM ${t.sandboxes} WHERE demo_owned AND sandbox_id IS DISTINCT FROM $1 AND sandbox_id IS DISTINCT FROM $2 ORDER BY sandbox_id FOR UPDATE`,
          [d!.current_id, d!.candidate_id]
        )
        for (const row of retired) {
          const jobs = yield* sql.unsafe<{ id: string }>(
            `SELECT j.id FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id WHERE a.sandbox_id=$1 AND j.state IN ('Completed','Dead','Isolated') ORDER BY j.id LIMIT ${limits.cleanupBatch} FOR UPDATE OF j SKIP LOCKED`,
            [row.sandbox_id]
          )
          for (const job of jobs) {
            yield* sql.unsafe(`DELETE FROM ${t.ledger} WHERE job_id=$1`, [job.id])
            yield* sql.unsafe(
              `DELETE FROM ${t.associations} WHERE sandbox_id=$1 AND job_id=$2`,
              [row.sandbox_id, job.id]
            )
            yield* sql.unsafe(
              `DELETE FROM ${t.jobs} WHERE id=$1 AND state IN ('Completed','Dead','Isolated')`,
              [job.id]
            )
          }
          const [remaining] = yield* sql.unsafe<{ n: string }>(
            `SELECT count(*) AS n FROM ${t.associations} WHERE sandbox_id=$1`,
            [row.sandbox_id]
          )
          if (Number(remaining!.n) === 0) {
            // Only whole retired-sandbox teardown removes durable problem evidence.
            // Individual source/successor deletion preserves membership/tombstones.
            const repairs = RepairSchema.relations(schema)
            for (const table of [
              repairs.audit,
              repairs.edges,
              `"${schema}"."operator_redrives"`,
              repairs.members,
              repairs.problems,
              repairs.receipts,
              t.receipts,
              t.audit,
              repairs.admission,
              t.admission
            ]) {
              yield* sql.unsafe(`DELETE FROM ${table} WHERE sandbox_id=$1`, [
                row.sandbox_id
              ])
            }
          }
          yield* sql.unsafe(
            `DELETE FROM ${t.sandboxes} s WHERE s.sandbox_id=$1 AND NOT EXISTS(SELECT 1 FROM ${t.associations} a WHERE a.sandbox_id=s.sandbox_id)`,
            [row.sandbox_id]
          )
        }
        if (!d!.candidate_id && (!d!.current_id || now >= Number(d!.rotate_at))) {
          const [size] = yield* sql.unsafe<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${t.sandboxes} WHERE demo_owned`
          )
          // Do not accumulate generations when draining/cleanup is unavailable.
          if (size!.n >= 2) {
            return { phase: "cleanup-blocked" }
          }
          const id = `public-demo-${crypto.randomUUID()}`
          const expires = now + rotationMillis + 600_000
          yield* sql.unsafe(
            `INSERT INTO ${t.sandboxes}(sandbox_id,generation,expires_at,credential_hash,viewer_until,demo_owned) VALUES($1,1,$2,$3,$2,true)`,
            [id, expires, `internal-demo:${id}`]
          )
          for (const [index, behavior] of (
            ["success", "dead", "isolated", "retry-then-success", "success"] as const
          ).entries()) {
            yield* seedBatch(
              schema,
              id,
              `seed-${index}`,
              index,
              behavior,
              index === 4 ? now + 120_000 : now
            )
          }
          yield* sql.unsafe(`UPDATE ${control} SET candidate_id=$1 WHERE singleton`, [id])
          return { phase: "preparing", id }
        }
        if (d!.candidate_id) {
          const states = yield* sql.unsafe<{ state: string; n: number }>(
            `SELECT j.state,count(*)::int AS n FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id WHERE a.sandbox_id=$1 GROUP BY j.state`,
            [d!.candidate_id]
          )
          const ready =
            states.reduce((sum, row) => sum + row.n, 0) === limits.seedJobs &&
            ["Completed", "Dead", "Isolated"].every((state) =>
              states.some((row) => row.state === state && row.n >= 6)
            )
          if (!ready) {
            return { phase: "preparing", id: d!.candidate_id }
          }
          yield* sql.unsafe(
            `UPDATE ${control} SET current_id=candidate_id,candidate_id=NULL,rotate_at=$1,next_tick=$2,sequence=0 WHERE singleton`,
            [now + rotationMillis, now + limits.tickMillis]
          )
          return { phase: "published", id: d!.candidate_id }
        }
        if (d!.current_id && now >= Number(d!.next_tick)) {
          // Demo's DB cap is 20,000, so normalize v4 integer/v5 bigint to a number.
          const [s] = yield* sql.unsafe<{ retained_jobs: number }>(
            `SELECT retained_jobs::int AS retained_jobs FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
            [d!.current_id]
          )
          const sequence = Number(d!.sequence)
          const batch = Traffic.batch(sequence)
          if (s!.retained_jobs + batch.jobs.length > limits.maxJobs) {
            yield* sql.unsafe(`UPDATE ${control} SET rotate_at=$1 WHERE singleton`, [now])
            return { phase: "quota" }
          }
          // Reproducible bursts of 1–3 jobs; delayed eligibility and visible retries.
          // Every alarm advances the durable slot; a missed alarm never backfills a burst.
          yield* seedBatch(
            schema,
            d!.current_id,
            `tick-${sequence}`,
            sequence,
            "success",
            now,
            batch.jobs.length,
            batch.jobs
          )
          yield* sql.unsafe(
            `UPDATE ${control} SET sequence=sequence+1,next_tick=$1 WHERE singleton`,
            [now + batch.afterMillis]
          )
          return { phase: "running" }
        }
        return { phase: "waiting" }
      })
    )
  })
