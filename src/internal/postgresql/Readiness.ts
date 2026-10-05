import { Effect } from "effect"
import { PostgreSqlFailure } from "../../PostgreSqlTransaction.js"
import type { ApplicationAdapter } from "../../PostgreSqlTransaction.js"

/** Explicit bounded introspection of only the two configured relations, never DDL. */
export const ready = (adapter: ApplicationAdapter, jobs: string, payloads: string) =>
  adapter.ownedTransaction((query) =>
    Effect.gen(function* () {
      yield* query.query(`SELECT id,operation,operation_id,slot,queue,kind,version,policy,initial_available_at,
    state,available_at,updated_at,attempts_made,stalled_count,lifecycle_version,lease_token,lease_expires_at,
    completed_at,last_failure_code,cleanup_at FROM ${jobs} LIMIT 0`)
      yield* query.query(
        `SELECT job_id,format_version,payload,projection FROM ${payloads} LIMIT 0`
      )
      const constraints = yield* query.query(
        `SELECT c.conrelid=$1::regclass AS jobs,c.conrelid=$2::regclass AS payloads,c.contype AS kind,
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
        !has("jobs", "u", ["lease_token"]) ||
        !has("payloads", "p", ["job_id"]) ||
        !fk
      ) {
        return yield* new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
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
          columns: ["queue", "kind", "version", "available_at", "id"],
          predicate: "state=ANYARRAY['Pending','RetryScheduled']"
        },
        { columns: ["lease_expires_at", "id"], predicate: "state='Active'" },
        { columns: ["cleanup_at", "id"], predicate: "state=ANYARRAY['Completed','Dead']" }
      ]
      for (const expected of required) {
        if (
          !indexes.some(
            (i) =>
              names(i.columns, expected.columns) &&
              typeof i.predicate === "string" &&
              i.predicate.replace(/\s|\(|\)|::text/g, "") === expected.predicate
          )
        ) {
          return yield* new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
        }
      }
    })
  )
