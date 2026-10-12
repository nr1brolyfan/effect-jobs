import type { ListJobs, JobDetailRequest } from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"

// App-owned read model, not a public library read/admin API. Identifiers are
// configuration only; all request values use PostgreSQL parameters.
export interface Mapping {
  readonly schema: string
  readonly jobsTable: string
  readonly sandboxesTable: string
  readonly associationsTable: string
}
export interface Query {
  readonly text: string
  readonly values: ReadonlyArray<unknown>
}
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(name)) {
    throw new Error("Invalid read mapping identifier")
  }
  return `"${name}"`
}
const summary = `jsonb_build_object(
  'jobId',j.id,'catalog',jsonb_build_object('queue',j.queue,'kind',j.kind,'version',j.version),
  'state',j.state,'availableAt',j.available_at,'updatedAt',j.updated_at,
  'completedAt',j.completed_at,'attemptsMade',j.attempts_made,
  'stalledCount',j.stalled_count,'lifecycleVersion',j.lifecycle_version,
  'lastFailureCode',j.last_failure_code)`

export const make = (mapping: Mapping) => {
  const schema = identifier(mapping.schema)
  const jobs = `${schema}.${identifier(mapping.jobsTable)}`
  const sandboxes = `${schema}.${identifier(mapping.sandboxesTable)}`
  const associations = `${schema}.${identifier(mapping.associationsTable)}`
  if (
    new Set([mapping.jobsTable, mapping.sandboxesTable, mapping.associationsTable])
      .size !== 3
  ) {
    throw new Error("Read mapping tables must differ")
  }
  // DB time and authority/data share a single statement snapshot. Reset/expiry
  // committed before statement start is visible; later commits reconcile next read.
  const authority = `WITH authority AS MATERIALIZED (
    SELECT CASE WHEN expires_at <= floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      THEN 'sandbox-expired' WHEN generation <> $2 THEN 'stale-generation' ELSE 'ok' END AS status
    FROM ${sandboxes} WHERE sandbox_id=$1
  ), status AS (
    SELECT coalesce((SELECT status FROM authority),'sandbox-expired') AS code
  )`
  const scoped = `FROM ${associations} a JOIN ${jobs} j ON j.id=a.job_id
    WHERE a.sandbox_id=$1 AND a.generation=$2 AND (SELECT code FROM status)='ok'`
  return {
    list: (ref: SandboxRef, request: ListJobs, after: string | null): Query => ({
      text: `${authority}, page AS (
        SELECT j.id, ${summary} AS item ${scoped}
          AND ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
          AND ($5::text IS NULL OR j.id COLLATE "C" > $5 COLLATE "C")
        ORDER BY j.id COLLATE "C" ASC LIMIT $6
       ), totals AS (
         SELECT jsonb_build_object('total',count(*),
           'Pending',count(*) FILTER(WHERE j.state='Pending'),
           'RetryScheduled',count(*) FILTER(WHERE j.state='RetryScheduled'),
           'Active',count(*) FILTER(WHERE j.state='Active'),
           'Completed',count(*) FILTER(WHERE j.state='Completed'),
           'Dead',count(*) FILTER(WHERE j.state='Dead'),
           'Isolated',count(*) FILTER(WHERE j.state='Isolated')) AS stats ${scoped}
       ) SELECT (SELECT code FROM status) AS status, (SELECT stats FROM totals) AS stats,
        coalesce(jsonb_agg(item ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [
        ref.sandboxId,
        ref.generation,
        request.filters.state ?? null,
        request.filters.kind ?? null,
        after,
        request.limit + 1
      ]
    }),
    detail: (ref: SandboxRef, request: JobDetailRequest): Query => ({
      text: `${authority} SELECT (SELECT code FROM status) AS status, (
        SELECT jsonb_build_object('sandbox',jsonb_build_object('sandboxId',$1::text,'generation',$2::bigint),
          'job',${summary},'producer',jsonb_build_object('operation',j.operation,
          'operationId',j.operation_id,'slot',j.slot),'policy',j.policy,'relations',a.relations)
        ${scoped} AND j.id=$3
      ) AS detail`,
      values: [ref.sandboxId, ref.generation, request.jobId]
    })
  }
}
