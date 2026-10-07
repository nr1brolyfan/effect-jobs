/**
 * Validated table mappings and explicit application-owned migration SQL.
 */
import { Data } from "effect"
import { createHash } from "node:crypto"

/**
 * Thrown for invalid table configuration or returned for invalid backend budget.
 *
 * @category errors
 */
export class PostgreSqlConfigurationError extends Data.TaggedError(
  "PostgreSqlConfigurationError"
)<{
  readonly field:
    | "schema"
    | "jobsTable"
    | "payloadsTable"
    | "operationResponseBudgetMillis"
    | "operationTimeoutMillis"
}> {}
/**
 * Optional lowercase PostgreSQL identifiers; defaults to public.jobs/job_payloads.
 *
 * @category models
 */
export interface TableOptions {
  readonly schema?: string
  readonly jobsTable?: string
  readonly payloadsTable?: string
}
/**
 * Complete storage mapping shared by backend and application migration generation.
 *
 * @category models
 */
export interface Tables {
  readonly schema: string
  readonly jobsTable: string
  readonly payloadsTable: string
}
const identifier = (value: string, field: "schema" | "jobsTable" | "payloadsTable") => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new PostgreSqlConfigurationError({ field })
  }
  return value
}
/**
 * Validates and freezes mapping without database access. Names match
 * ^[a-z_][a-z0-9_]{0,62}$ and tables must differ; throws PostgreSqlConfigurationError.
 *
 * @category constructors
 */
export const tables = (options: TableOptions = {}): Tables => {
  const schema = identifier(options.schema ?? "public", "schema")
  const jobsTable = identifier(options.jobsTable ?? "jobs", "jobsTable")
  const payloadsTable = identifier(
    options.payloadsTable ?? "job_payloads",
    "payloadsTable"
  )
  if (jobsTable === payloadsTable) {
    throw new PostgreSqlConfigurationError({ field: "payloadsTable" })
  }
  return Object.freeze({ schema, jobsTable, payloadsTable })
}
/**
 * Returns quoted qualified relation names after validating the mapping.
 * Never interpolate producer or catalog values as identifiers.
 *
 * @category operations
 */
export const relations = (mapping: Tables) => {
  const checked = tables(mapping)
  return {
    jobs: `"${checked.schema}"."${checked.jobsTable}"`,
    payloads: `"${checked.schema}"."${checked.payloadsTable}"`
  }
}
/**
 * Bounded schema-wide index prefix retaining a hash of the jobs table name.
 *
 * @category operations
 */
export const indexPrefix = (mapping: Tables): string =>
  `${mapping.jobsTable.slice(0, 32)}_${createHash("sha256").update(mapping.jobsTable).digest("hex").slice(0, 16)}`
/**
 * Returns DDL for the configured jobs and immutable payload tables and indexes.
 * The application creates the schema and runs migrations; runtime never invokes DDL.
 * Use the same mapping for backend construction.
 *
 * @example
 * ```ts
 * import * as Storage from "effect-jobs/PostgreSqlSchema"
 *
 * const mapping = Storage.tables({ schema: "app_jobs" })
 * const ddl = Storage.migration(mapping) // Run through application-owned migrations.
 * ```
 *
 * @category operations
 */
export const migration = (mapping: Tables = tables()): string => {
  const { jobs, payloads } = relations(mapping)
  // Index names are table-local derivatives bounded below PostgreSQL's 63-byte limit.
  const prefix = indexPrefix(mapping)
  return `CREATE TABLE ${jobs} (
  id text PRIMARY KEY,
  operation text NOT NULL, operation_id text NOT NULL, slot text NOT NULL,
  queue text NOT NULL, kind text NOT NULL, version integer NOT NULL,
  policy jsonb NOT NULL, initial_available_at bigint,
  state text NOT NULL CHECK (state IN ('Pending','Active','RetryScheduled','Completed','Dead','Isolated')),
  available_at bigint NOT NULL, updated_at bigint NOT NULL,
  attempts_made bigint NOT NULL DEFAULT 0 CHECK (attempts_made >= 0),
  stalled_count bigint NOT NULL DEFAULT 0 CHECK (stalled_count >= 0),
  lifecycle_version bigint NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0),
  lease_token text, lease_expires_at bigint, completed_at bigint, last_failure_code text, cleanup_at bigint,
  UNIQUE (operation, operation_id, slot), UNIQUE (lease_token),
  CHECK ((state = 'Active') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state = 'Active' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state IN ('Completed','Dead')) = (completed_at IS NOT NULL))
);
CREATE TABLE ${payloads} (
  job_id text PRIMARY KEY REFERENCES ${jobs}(id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
  projection bytea NOT NULL CHECK (octet_length(projection) BETWEEN 1 AND 65536)
);
CREATE INDEX "${prefix}_due" ON ${jobs} (queue, kind, version, available_at, id)
  WHERE state IN ('Pending','RetryScheduled');
CREATE INDEX "${prefix}_expired" ON ${jobs} (lease_expires_at, id) WHERE state = 'Active';
CREATE INDEX "${prefix}_terminal" ON ${jobs} (cleanup_at, id) WHERE state IN ('Completed','Dead');`
}
