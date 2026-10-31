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
const lineagePresence = `(original_source_job_id IS NULL AND source_job_id IS NULL AND redrive_kind IS NULL)
    OR (original_source_job_id IS NOT NULL AND redrive_kind IS NOT NULL)`
const lineageConstraints = (
  prefix: string
) => `CONSTRAINT "${prefix}_lineage" CHECK (${lineagePresence}),
  CONSTRAINT "${prefix}_edge_kind" CHECK (redrive_kind IN ('Redrive','CorrectedRedrive')),
  CONSTRAINT "${prefix}_edge_id" CHECK (original_source_job_id <> id),
  CONSTRAINT "${prefix}_edge_live" CHECK (source_job_id = original_source_job_id)`
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
  state text NOT NULL CHECK (state IN ('Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled')),
  available_at bigint NOT NULL, updated_at bigint NOT NULL,
  created_at bigint,
  attempts_made bigint NOT NULL DEFAULT 0 CHECK (attempts_made >= 0),
  stalled_count bigint NOT NULL DEFAULT 0 CHECK (stalled_count >= 0),
  lifecycle_version bigint NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0),
  lease_token text, lease_expires_at bigint, completed_at bigint, last_failure_code text, cleanup_at bigint,
  original_source_job_id text, source_job_id text, redrive_kind text,
  ${lineageConstraints(prefix)},
  CONSTRAINT "${prefix}_source_fk" FOREIGN KEY (source_job_id) REFERENCES ${jobs}(id) ON DELETE SET NULL,
  UNIQUE (operation, operation_id, slot), UNIQUE (lease_token),
  CHECK ((state = 'Active') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state = 'Active' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state IN ('Completed','Dead','Cancelled')) = (completed_at IS NOT NULL))
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
CREATE INDEX "${prefix}_terminal" ON ${jobs} (cleanup_at, id) WHERE state IN ('Completed','Dead');
CREATE INDEX "${prefix}_source" ON ${jobs} (source_job_id) WHERE source_job_id IS NOT NULL;`
}

/** Known catalog expressions for the additive operator migration.
 * @internal
 */
const operatorChecks = {
  state:
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled']",
  terminal: "state=ANYARRAY['Completed','Dead','Cancelled']=completed_atISNOTNULL"
} as const
/** Adds Cancelled to exactly the two known legacy CHECKs; refuses unexpected schema.
 * Does not alter rows, indexes or unrelated constraints. The application runs it
 * in its migration transaction after preserving historical migration bytes.
 * @category operations
 */
export const operatorMigration = (mapping: Tables = tables()): string => {
  const { jobs } = relations(mapping)
  const oldState =
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated']"
  const oldTerminal = "state=ANYARRAY['Completed','Dead']=completed_atISNOTNULL"
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  return `DO $operator_migration$
DECLARE c record; state_name text; terminal_name text; state_count integer := 0; terminal_count integer := 0;
BEGIN
  LOCK TABLE ${jobs} IN ACCESS EXCLUSIVE MODE;
  FOR c IN SELECT conname, regexp_replace(pg_get_expr(conbin,conrelid), '[[:space:]()]|::text', '', 'g') AS expression
    FROM pg_catalog.pg_constraint WHERE conrelid=${literal(jobs)}::regclass AND contype='c'
  LOOP
    IF c.expression IN (${literal(oldState)},${literal(operatorChecks.state)}) THEN
      state_name := c.conname; state_count := state_count + 1;
    ELSIF c.expression IN (${literal(oldTerminal)},${literal(operatorChecks.terminal)}) THEN
      terminal_name := c.conname; terminal_count := terminal_count + 1;
    END IF;
  END LOOP;
  IF state_count <> 1 OR terminal_count <> 1 THEN
    RAISE EXCEPTION 'unsupported operator CHECK constraints';
  END IF;
  EXECUTE format('ALTER TABLE ${jobs} DROP CONSTRAINT %I, DROP CONSTRAINT %I', state_name, terminal_name);
  EXECUTE format('ALTER TABLE ${jobs} ADD CONSTRAINT %I CHECK (state IN (''Pending'',''Active'',''RetryScheduled'',''Completed'',''Dead'',''Isolated'',''Cancelled'')), ADD CONSTRAINT %I CHECK ((state IN (''Completed'',''Dead'',''Cancelled'')) = (completed_at IS NOT NULL))', state_name, terminal_name);
END $operator_migration$;`
}

/** Add empty lineage to existing rows; never infer historical operator edges.
 * Applications run this once in their own migration transaction.
 * @category operations
 */
export const lineageMigration = (mapping: Tables = tables()): string => {
  const { jobs } = relations(mapping)
  const prefix = indexPrefix(mapping)
  return `ALTER TABLE ${jobs}
  ADD COLUMN original_source_job_id text,
  ADD COLUMN source_job_id text,
  ADD COLUMN redrive_kind text,
  ADD ${lineageConstraints(prefix).replaceAll(",\n  CONSTRAINT", ",\n  ADD CONSTRAINT")},
  ADD CONSTRAINT "${prefix}_source_fk" FOREIGN KEY (source_job_id) REFERENCES ${jobs}(id) ON DELETE SET NULL;
CREATE INDEX "${prefix}_source" ON ${jobs} (source_job_id) WHERE source_job_id IS NOT NULL;`
}

/** Adds truthful creation metadata without inventing times for existing rows.
 * Applications run this once in their own migration transaction. Runtime never
 * migrates; readiness requires this nullable bigint column before use.
 * @category operations
 */
export const creationTimeMigration = (mapping: Tables = tables()): string =>
  `ALTER TABLE ${relations(mapping).jobs} ADD COLUMN created_at bigint;`
