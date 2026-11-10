// Frozen playground-v1 SQL generator from accepted base 5e17f109.
// Historical migration bytes must never follow later library schema changes.
import { indexPrefix, relations, tables, type Tables } from "effect-jobs/PostgreSqlSchema"

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
