import { Effect } from "effect"
import { PostgreSqlFailure } from "../PostgreSqlTransaction.js"
import type { ApplicationAdapter } from "../PostgreSqlTransaction.js"

const operatorChecks = {
  state:
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled']",
  terminal: "state=ANYARRAY['Completed','Dead','Cancelled']=completed_atISNOTNULL",
  lineage:
    "original_source_job_idISNULLANDsource_job_idISNULLANDredrive_kindISNULLORoriginal_source_job_idISNOTNULLANDredrive_kindISNOTNULL",
  kind: "redrive_kind=ANYARRAY['Redrive','CorrectedRedrive']",
  identity: "original_source_job_id<>id",
  live: "source_job_id=original_source_job_id"
} as const

/** Explicit bounded introspection of only the two configured relations, never DDL. */
export const ready = (adapter: ApplicationAdapter, jobs: string, payloads: string) =>
  adapter.ownedTransaction((query) =>
    Effect.gen(function* () {
      yield* query.query(`SELECT id,operation,operation_id,slot,queue,kind,version,policy,initial_available_at,
    state,available_at,updated_at,created_at,attempts_made,stalled_count,lifecycle_version,lease_token,lease_expires_at,
    completed_at,last_failure_code,cleanup_at,original_source_job_id,source_job_id,redrive_kind FROM ${jobs} LIMIT 0`)
      yield* query.query(
        `SELECT job_id,format_version,payload,projection FROM ${payloads} LIMIT 0`
      )
      const creationColumns = yield* query.query(
        `SELECT attnotnull AS required,atttypid='bigint'::regtype AS bigint,atthasdef AS has_default
         FROM pg_catalog.pg_attribute WHERE attrelid=$1::regclass AND NOT attisdropped
         AND attname='created_at'`,
        [jobs]
      )
      if (
        creationColumns.length !== 1 ||
        creationColumns[0]?.required !== false ||
        creationColumns[0]?.bigint !== true ||
        creationColumns[0]?.has_default !== false
      ) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: { reason: "invalid-column-definition", check: "created-at" }
        })
      }
      const lineageColumns = yield* query.query(
        `SELECT attname AS name,attnotnull AS required,atttypid='text'::regtype AS text
         FROM pg_catalog.pg_attribute WHERE attrelid=$1::regclass AND NOT attisdropped
         AND attname IN ('original_source_job_id','source_job_id','redrive_kind')`,
        [jobs]
      )
      if (
        lineageColumns.length !== 3 ||
        !["original_source_job_id", "source_job_id", "redrive_kind"].every((name) =>
          lineageColumns.some(
            (column) =>
              column.name === name && column.required === false && column.text === true
          )
        )
      ) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: { reason: "invalid-column-definition", check: "lineage" }
        })
      }
      const constraints = yield* query.query(
        `SELECT c.conrelid=$1::regclass AS jobs,c.conrelid=$2::regclass AS payloads,c.contype AS kind, pg_catalog.pg_get_expr(c.conbin,c.conrelid) AS expression,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,i)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.i) AS columns,
    c.confrelid=$1::regclass AS target_jobs,c.confdeltype AS deletion,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,i)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.i) AS target_columns
    FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ($1::regclass,$2::regclass)`,
        [jobs, payloads]
      )
      const names = (values: unknown, expected: ReadonlyArray<string>) =>
        Array.isArray(values) &&
        values.length === expected.length &&
        values.every((value, i) => value === expected[i])
      const has = (
        table: "jobs" | "payloads",
        kind: string,
        columns: ReadonlyArray<string>
      ) =>
        constraints.some(
          (c) => c[table] === true && c.kind === kind && names(c.columns, columns)
        )
      const fk = constraints.some(
        (c) =>
          c.payloads === true &&
          c.kind === "f" &&
          names(c.columns, ["job_id"]) &&
          c.target_jobs === true &&
          names(c.target_columns, ["id"]) &&
          c.deletion === "c"
      )
      if (
        !has("jobs", "p", ["id"]) ||
        !has("jobs", "u", ["operation", "operation_id", "slot"]) ||
        !has("jobs", "u", ["lease_token"])
      ) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: { reason: "missing-required-constraint", check: "job-keys" }
        })
      }
      if (!has("payloads", "p", ["job_id"]) || !fk) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: {
            reason: "missing-required-constraint",
            check: "payload-key-and-cascade"
          }
        })
      }
      if (
        !Object.values(operatorChecks).every((expected) =>
          constraints.some(
            (c) =>
              c.jobs === true &&
              c.kind === "c" &&
              typeof c.expression === "string" &&
              c.expression.replace(/\s|\(|\)|::text/g, "") === expected
          )
        ) ||
        !constraints.some(
          (c) =>
            c.jobs === true &&
            c.kind === "f" &&
            names(c.columns, ["source_job_id"]) &&
            c.target_jobs === true &&
            names(c.target_columns, ["id"]) &&
            c.deletion === "n"
        )
      ) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: {
            reason: "missing-required-constraint",
            check: "operator-lineage-and-state"
          }
        })
      }
      const indexes = yield* query.query(
        `SELECT ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(n,o)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n ORDER BY k.o) AS columns,
    pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_catalog.pg_index i
    WHERE i.indrelid=$1::regclass AND i.indisvalid AND i.indisready`,
        [jobs]
      )
      const required = [
        {
          check: "lineage",
          columns: ["source_job_id"],
          predicate: "source_job_idISNOTNULL"
        },
        {
          check: "claim",
          columns: ["queue", "kind", "version", "available_at", "id"],
          predicate: "state=ANYARRAY['Pending','RetryScheduled']"
        },
        {
          check: "recovery",
          columns: ["lease_expires_at", "id"],
          predicate: "state='Active'"
        },
        {
          check: "cleanup",
          columns: ["cleanup_at", "id"],
          predicate: "state=ANYARRAY['Completed','Dead']"
        }
      ] as const
      for (const expected of required) {
        if (
          !indexes.some(
            (i) =>
              names(i.columns, expected.columns) &&
              typeof i.predicate === "string" &&
              i.predicate.replace(/\s|\(|\)|::text/g, "") === expected.predicate
          )
        ) {
          return yield* new PostgreSqlFailure({
            commitKnowledge: "NotCommitted",
            readiness: { reason: "missing-required-index", check: expected.check }
          })
        }
      }
    })
  )
