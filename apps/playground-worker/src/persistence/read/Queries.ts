import type { ListJobs, JobDetailRequest } from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"

// App-owned read model, not a public library read/admin API. Identifiers are
// configuration only; all request values use PostgreSQL parameters.
export interface Mapping {
  readonly schema: string
  readonly jobsTable: string
  readonly sandboxesTable: string
  readonly associationsTable: string
  readonly payloadsTable?: string
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
export const summary = `jsonb_build_object(
  'jobId',j.id,'catalog',jsonb_build_object('queue',j.queue,'name',j.kind,'version',j.version),
  'state',j.state,'availableAt',j.available_at,'updatedAt',j.updated_at,
  'completedAt',j.completed_at,'attemptsMade',j.attempts_made,
  'stalledCount',j.stalled_count,'lifecycleVersion',j.lifecycle_version,
  'lastFailureCode',j.last_failure_code)`

export const make = (mapping: Mapping) => {
  const schema = identifier(mapping.schema)
  const jobs = `${schema}.${identifier(mapping.jobsTable)}`
  const sandboxes = `${schema}.${identifier(mapping.sandboxesTable)}`
  const associations = `${schema}.${identifier(mapping.associationsTable)}`
  const payloads = `${schema}.${identifier(mapping.payloadsTable ?? "job_payloads")}`
  const problems = `${schema}."job_problems"`
  const members = `${schema}."job_repair_members"`
  const audit = `${schema}."repair_audit"`
  const receipts = `${schema}."command_receipts"`
  const ledger = `${schema}."provider_ledger"`
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
  const roots = `, retained AS MATERIALIZED (
    SELECT j.*,a.relations ${scoped}
  ), recorded AS MATERIALIZED (
    SELECT p.root_job_id,p.problem,tip.state AS tip_state,tip.updated_at AS tip_updated_at
    FROM ${problems} p LEFT JOIN retained tip ON tip.id=p.problem->>'activeSuccessorJobId'
    WHERE p.sandbox_id=$1 AND p.generation=$2 AND (SELECT code FROM status)='ok'
  ), effective AS MATERIALIZED (
    SELECT root_job_id,CASE WHEN problem->>'state'='InProgress' AND
      (tip_state IS NULL OR tip_state IN ('Completed','Dead','Isolated','Cancelled'))
      THEN problem || jsonb_build_object('state',CASE WHEN tip_state='Completed' AND problem->>'outcomeKnowledge'='KnownFailure' THEN 'Resolved' ELSE 'Open' END,
        'version',(problem->>'version')::bigint+1,'updatedAt',coalesce(tip_updated_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint),
        'resolution',CASE WHEN tip_state='Completed' AND problem->>'outcomeKnowledge'='KnownFailure' THEN
          jsonb_build_object('kind','SuccessorCompleted','reason',NULL,'successorJobId',problem->>'activeSuccessorJobId','observedAt',tip_updated_at) ELSE NULL END)
      ELSE problem END AS problem FROM recorded
    UNION ALL
    SELECT j.id,jsonb_build_object('rootJobId',j.id,'state','Open','version',0,'updatedAt',j.updated_at,
       'activeSuccessorJobId',NULL,'outcomeKnowledge',CASE WHEN j.state='Dead' AND j.last_failure_code IN ('fake_provider_terminal_rejected','fake_provider_retry_rejected') AND EXISTS(SELECT 1 FROM ${ledger} l WHERE l.sandbox_id=$1 AND l.generation=$2 AND l.job_id=j.id AND l.accepted=false AND l.invocations>0) THEN 'KnownFailure' ELSE 'Unknown' END,'resolution',NULL)
    FROM retained j WHERE j.state IN ('Dead','Isolated')
      AND NOT EXISTS(SELECT 1 FROM ${members} m WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM recorded p WHERE p.root_job_id=j.id)
  ), representatives AS MATERIALIZED (
    SELECT e.root_job_id,e.problem,coalesce(
      (SELECT id FROM retained WHERE id=e.problem->>'activeSuccessorJobId'),
      (SELECT id FROM retained WHERE id=e.root_job_id),
      (SELECT j.id FROM ${members} m JOIN retained j ON j.id=m.job_id WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.root_job_id=e.root_job_id ORDER BY j.id COLLATE "C" LIMIT 1)
    ) AS representative_id FROM effective e
  ), attention AS (
    SELECT jsonb_build_object('Open',count(*) FILTER(WHERE problem->>'state'='Open'),
      'InProgress',count(*) FILTER(WHERE problem->>'state'='InProgress'),
      'Resolved',count(*) FILTER(WHERE problem->>'state'='Resolved'),
      'needsAttention',count(*) FILTER(WHERE problem->>'state' IN ('Open','InProgress'))) AS stats FROM effective
  )`
  const totals = `, totals AS (
    SELECT jsonb_build_object('total',count(*),
      'Pending',count(*) FILTER(WHERE j.state='Pending'),
      'RetryScheduled',count(*) FILTER(WHERE j.state='RetryScheduled'),
      'Active',count(*) FILTER(WHERE j.state='Active'),
      'Completed',count(*) FILTER(WHERE j.state='Completed'),
      'Cancelled',count(*) FILTER(WHERE j.state='Cancelled'),
      'Dead',count(*) FILTER(WHERE j.state='Dead'),
      'Isolated',count(*) FILTER(WHERE j.state='Isolated')) AS stats FROM retained j
  )`
  const refValues = (ref: SandboxRef) => [ref.sandboxId, ref.generation]
  const related = `SELECT m.job_id AS id,jsonb_build_object('jobId',m.job_id,'state',j.state,
      'kind',coalesce(j.redrive_kind,(SELECT CASE WHEN e.action='redrive' THEN 'Redrive' ELSE 'CorrectedRedrive' END FROM ${schema}."job_repairs" e WHERE e.sandbox_id=$1 AND e.generation=$2 AND e.result_job_id=m.job_id),
      (SELECT 'Redrive' FROM ${schema}."operator_redrives" e WHERE e.sandbox_id=$1 AND e.generation=$2 AND e.original_successor_job_id=m.job_id)),
      'sourceAvailable',j.id IS NOT NULL) AS item
    FROM ${members} m LEFT JOIN retained j ON j.id=m.job_id
    WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.root_job_id=coalesce(
      (SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)
      AND m.job_id<>$3`
  const facts = `, facts AS MATERIALIZED (
    SELECT lpad(j.updated_at::text,15,'0')||':~snapshot' AS id,jsonb_build_object('_tag','Snapshot','job',${summary},'observedAt',j.updated_at) AS item
    FROM retained j WHERE j.id=$3
    UNION ALL
    SELECT lpad((r.receipt->'result'->>'observedAt'),15,'0')||':'||r.request_id||':'||(r.receipt->'result'->>'action'),
      jsonb_build_object('_tag','Operator','requestId',r.request_id,'action',r.receipt->'result'->>'action',
        'sourceJobId',r.receipt->'result'->>'sourceJobId','resultJobId',r.receipt->'result'->>'resultJobId',
        'observedAt',(r.receipt->'result'->>'observedAt')::bigint)
    FROM ${receipts} r WHERE r.sandbox_id=$1 AND r.generation=$2 AND r.operation='Operator' AND r.receipt->'result'->>'_tag'='Committed'
      AND (r.receipt->'result'->>'sourceJobId'=$3 OR r.receipt->'result'->>'resultJobId'=$3)
    UNION ALL
    SELECT lpad(a.observed_at::text,15,'0')||':'||a.identity||':'||a.action,
      a.fact - ARRAY['repairReason','operatorCategory','investigation','changes','validation']::text[]
    FROM ${audit} a WHERE a.sandbox_id=$1 AND a.generation=$2 AND a.root_job_id=coalesce(
      (SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)
  )`
  return {
    list: (ref: SandboxRef, request: ListJobs, after: string | null): Query => ({
      text: `${authority}${roots}${totals}, page AS (
        SELECT j.id,${summary} AS item FROM retained j
        WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
          AND ($5::text IS NULL OR j.id COLLATE "C">$5 COLLATE "C") ORDER BY j.id COLLATE "C" LIMIT $6
      ), filtered AS (
        SELECT count(*) AS n FROM retained j WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
      ) SELECT (SELECT code FROM status) AS status,(SELECT stats FROM totals) AS stats,
        (SELECT stats FROM attention) AS "attentionStats",(SELECT n FROM filtered)::double precision AS "filteredTotal",
        coalesce(jsonb_agg(item ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [
        ...refValues(ref),
        request.filters.state ?? null,
        request.filters.name ?? null,
        after,
        request.limit + 1
      ]
    }),
    problems: (ref: SandboxRef, request: ListJobs, after: string | null): Query => ({
      text: `${authority}${roots}${totals}, filtered AS MATERIALIZED (
        SELECT r.root_job_id,jsonb_build_object('problem',r.problem,'representative',CASE WHEN j.id IS NULL THEN NULL ELSE ${summary} END) AS item
        FROM representatives r LEFT JOIN retained j ON j.id=r.representative_id
        WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
          AND ($5::text IS NULL OR r.problem->>'state'=$5)
          AND (NOT $6::boolean OR r.problem->>'state' IN ('Open','InProgress'))
      ), page AS (
        SELECT * FROM filtered WHERE ($7::text IS NULL OR root_job_id COLLATE "C">$7 COLLATE "C") ORDER BY root_job_id COLLATE "C" LIMIT $8
      ) SELECT (SELECT code FROM status) AS status,(SELECT stats FROM totals) AS stats,(SELECT stats FROM attention) AS "attentionStats",
        (SELECT count(*) FROM filtered)::double precision AS "filteredTotal",coalesce(jsonb_agg(item ORDER BY root_job_id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [
        ...refValues(ref),
        request.filters.state ?? null,
        request.filters.name ?? null,
        request.filters.resolution ?? null,
        request.filters.needsAttention === true,
        after,
        request.limit + 1
      ]
    }),
    detail: (ref: SandboxRef, request: JobDetailRequest): Query => ({
      text: `${authority}${roots}${facts}, related_page AS (${related} ORDER BY m.job_id COLLATE "C" LIMIT 51), history_page AS (SELECT * FROM facts ORDER BY id COLLATE "C" LIMIT 51)
      SELECT (SELECT code FROM status) AS status,(
        SELECT jsonb_build_object('sandbox',jsonb_build_object('sandboxId',$1::text,'generation',$2::bigint),'job',${summary},
          'producer',jsonb_build_object('operation',j.operation,'operationId',j.operation_id,'slot',j.slot),'policy',j.policy,'relations',j.relations)
        FROM retained j WHERE j.id=$3) AS detail,
        (SELECT jsonb_build_object('rootJobId',e.root_job_id,'problem',e.problem) FROM effective e WHERE e.root_job_id=coalesce((SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)) AS problem,
        (SELECT jsonb_build_object('accepted',l.accepted,'invocations',l.invocations) FROM ${ledger} l WHERE l.sandbox_id=$1 AND l.generation=$2 AND l.job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS provider,
        (SELECT jsonb_build_object('originalSourceJobId',j.original_source_job_id,'sourceJobId',j.source_job_id,'kind',j.redrive_kind) FROM retained j WHERE j.id=$3 AND j.original_source_job_id IS NOT NULL) AS lineage,
        (SELECT format_version FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS format_version,
        (SELECT payload FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS payload,
        (SELECT projection FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS projection,
        coalesce((SELECT jsonb_agg(item ORDER BY id COLLATE "C") FROM related_page),'[]'::jsonb) AS related,
        coalesce((SELECT jsonb_agg(jsonb_build_object('key',id,'item',item) ORDER BY id COLLATE "C") FROM history_page),'[]'::jsonb) AS history`,
      values: [...refValues(ref), request.jobId]
    }),
    related: (
      ref: SandboxRef,
      request: JobDetailRequest & { readonly limit: number },
      after: string | null
    ): Query => ({
      text: `${authority}${roots}, page AS (${related} AND ($4::text IS NULL OR m.job_id COLLATE "C">$4 COLLATE "C") ORDER BY m.job_id COLLATE "C" LIMIT $5)
      SELECT (SELECT code FROM status) AS status,EXISTS(SELECT 1 FROM retained WHERE id=$3) AS found,coalesce(jsonb_agg(item ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [...refValues(ref), request.jobId, after, request.limit + 1]
    }),
    history: (
      ref: SandboxRef,
      request: JobDetailRequest & { readonly limit: number },
      after: string | null
    ): Query => ({
      text: `${authority}${roots}${facts}, page AS (SELECT * FROM facts WHERE ($4::text IS NULL OR id COLLATE "C">$4 COLLATE "C") ORDER BY id COLLATE "C" LIMIT $5)
      SELECT (SELECT code FROM status) AS status,EXISTS(SELECT 1 FROM retained WHERE id=$3) AS found,coalesce(jsonb_agg(jsonb_build_object('key',id,'item',item) ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [...refValues(ref), request.jobId, after, request.limit + 1]
    })
  }
}
