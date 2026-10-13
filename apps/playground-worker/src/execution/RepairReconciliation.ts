// @effect-diagnostics unstableApiUsage:off
import { Effect, Schema } from "effect"
import { JobSnapshot } from "effect-jobs/JobLifecycle"
import { SqlClient } from "effect/sql/SqlClient"
import type { JobProblem } from "@effect-jobs/playground-contracts/Repairs"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as RepairSource from "../persistence/commands/RepairSource.js"
import * as RepairSchema from "../persistence/commands/RepairSchema.js"

// Pure projection shared by locked maintenance/commands and SELECT projections.
// A late observation never overwrites a manual close or a newer selected tip.
export const effectiveProblem = (
  problem: JobProblem,
  successor: Pick<JobSummary, "jobId" | "state" | "lifecycleVersion"> | null,
  observedAt: number
): JobProblem => {
  if (problem.state !== "InProgress" || problem.activeSuccessorJobId === null) {
    return problem
  }
  if (successor && successor.jobId !== problem.activeSuccessorJobId) {
    return problem
  }
  if (successor && ["Pending", "RetryScheduled", "Active"].includes(successor.state)) {
    return problem
  }
  if (problem.version === Number.MAX_SAFE_INTEGER) {
    throw new Error("Resolution version exhausted")
  }
  const resolved =
    successor?.state === "Completed" && problem.outcomeKnowledge === "KnownFailure"
  return {
    ...problem,
    version: problem.version + 1,
    updatedAt: observedAt,
    state: resolved ? "Resolved" : "Open",
    resolution: resolved
      ? {
          kind: "SuccessorCompleted",
          reason: null,
          observedAt,
          successorJobId: problem.activeSuccessorJobId
        }
      : null
  }
}

// The native adapter also invokes this under the already-held sandbox/problem
// locks before comparing expectedResolutionVersion. No job lifecycle SQL here.
export const reconcileLocked = (
  schema: string,
  sandboxId: string,
  generation: number,
  rootJobId: string
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = RepairSchema.relations(schema)
    const [row] = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT problem FROM ${t.problems} WHERE sandbox_id=$1 AND generation=$2 AND root_job_id=$3 FOR UPDATE`,
      [sandboxId, generation, rootJobId]
    )
    if (!row) {
      return null
    }
    const problem = yield* RepairSchema.decodeProblem(row.problem)
    if (problem.rootJobId !== rootJobId) {
      return yield* new PlaygroundError({ code: "unavailable" })
    }
    if (problem.state !== "InProgress") {
      return problem
    }
    const [successor] = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT j.* FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
      [sandboxId, generation, problem.activeSuccessorJobId]
    )
    if (successor) {
      yield* Schema.decodeUnknownEffect(JobSnapshot)(
        {
          jobId: successor.id,
          policy: successor.policy,
          state: successor.state,
          availableAt: Number(successor.available_at),
          updatedAt: Number(successor.updated_at),
          attemptsMade: Number(successor.attempts_made),
          stalledCount: Number(successor.stalled_count),
          lifecycleVersion: Number(successor.lifecycle_version),
          leaseToken: successor.lease_token,
          leaseExpiresAt:
            successor.lease_expires_at === null
              ? null
              : Number(successor.lease_expires_at),
          completedAt:
            successor.completed_at === null ? null : Number(successor.completed_at),
          lastFailureCode: successor.last_failure_code
        },
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    }
    const [clock] = yield* sql.unsafe<{ now: string }>(
      `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`
    )
    const next = effectiveProblem(
      problem,
      successor
        ? {
            jobId: String(successor.id) as JobSummary["jobId"],
            state: successor.state as JobSummary["state"],
            lifecycleVersion: Number(successor.lifecycle_version)
          }
        : null,
      Number(clock!.now)
    )
    if (next === problem) {
      return problem
    }
    yield* sql.unsafe(
      `UPDATE ${t.problems} SET problem=$4::jsonb WHERE sandbox_id=$1 AND generation=$2 AND root_job_id=$3`,
      [sandboxId, generation, rootJobId, JSON.stringify(next)]
    )
    const identity = yield* RepairSource.digestJson([
      rootJobId,
      problem.activeSuccessorJobId,
      successor ? Number(successor.lifecycle_version) : null
    ]).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    yield* sql.unsafe(
      `INSERT INTO ${t.audit}(sandbox_id,generation,identity,root_job_id,successor_job_id,observed_lifecycle_version,action,fact,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,'reconciliation',$7::jsonb,$8) ON CONFLICT DO NOTHING`,
      [
        sandboxId,
        generation,
        identity,
        rootJobId,
        problem.activeSuccessorJobId,
        successor ? Number(successor.lifecycle_version) : null,
        JSON.stringify({
          _tag: "Resolution",
          rootJobId,
          state: next.state,
          kind: next.resolution?.kind ?? "Reopened",
          reason: null,
          observedAt: next.updatedAt
        }),
        next.updatedAt
      ]
    )
    return next
  })

export const run = (schema: string, options: { readonly limit: number }) =>
  Effect.gen(function* () {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
      return yield* new PlaygroundError({ code: "invalid-request" })
    }
    const sql = yield* SqlClient
    const t = RepairSchema.relations(schema)
    const candidates = yield* sql.unsafe<{
      sandbox_id: string
      generation: string
      root_job_id: string
    }>(
      `SELECT p.sandbox_id,p.generation,p.root_job_id FROM ${t.problems} p JOIN ${t.sandboxes} s ON s.sandbox_id=p.sandbox_id
     LEFT JOIN ${t.associations} a ON a.sandbox_id=p.sandbox_id AND a.generation=p.generation AND a.job_id=p.problem->>'activeSuccessorJobId'
     LEFT JOIN ${t.jobs} j ON j.id=a.job_id
     WHERE p.problem->>'state'='InProgress' AND (j.id IS NULL OR j.state IN ('Completed','Dead','Isolated','Cancelled')) AND s.generation=p.generation AND s.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
     ORDER BY p.root_job_id COLLATE "C" LIMIT $1`,
      [options.limit]
    )
    let changed = 0
    // Serial native transactions, bounded by caller, under the existing executor.
    for (const candidate of candidates) {
      changed += yield* sql.withTransaction(
        Effect.gen(function* () {
          const [sandbox] = yield* sql.unsafe<{ generation: string; expires_at: string }>(
            `SELECT generation,expires_at FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
            [candidate.sandbox_id]
          )
          const [clock] = yield* sql.unsafe<{ now: string }>(
            `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`
          )
          if (
            !sandbox ||
            Number(sandbox.generation) !== Number(candidate.generation) ||
            Number(sandbox.expires_at) <= Number(clock!.now)
          ) {
            return 0
          }
          const next = yield* reconcileLocked(
            schema,
            candidate.sandbox_id,
            Number(candidate.generation),
            candidate.root_job_id
          )
          const [finalClock] = yield* sql.unsafe<{ now: string }>(
            `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`
          )
          if (Number(sandbox.expires_at) <= Number(finalClock!.now)) {
            return yield* new PlaygroundError({ code: "sandbox-expired" })
          }
          return next?.state !== "InProgress" ? 1 : 0
        })
      )
    }
    return { inspected: candidates.length, changed }
  })
