-- Pre-history PostgreSQL migration from ff593dcb9c0533be955e62711d8f724c3fb7910b.
CREATE TABLE "attempt_fixture"."tasks" (
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
  CONSTRAINT "tasks_085154084c742759_lineage" CHECK ((original_source_job_id IS NULL AND source_job_id IS NULL AND redrive_kind IS NULL)
    OR (original_source_job_id IS NOT NULL AND redrive_kind IS NOT NULL)),
  CONSTRAINT "tasks_085154084c742759_edge_kind" CHECK (redrive_kind IN ('Redrive','CorrectedRedrive')),
  CONSTRAINT "tasks_085154084c742759_edge_id" CHECK (original_source_job_id <> id),
  CONSTRAINT "tasks_085154084c742759_edge_live" CHECK (source_job_id = original_source_job_id),
  CONSTRAINT "tasks_085154084c742759_source_fk" FOREIGN KEY (source_job_id) REFERENCES "attempt_fixture"."tasks"(id) ON DELETE SET NULL,
  UNIQUE (operation, operation_id, slot), UNIQUE (lease_token),
  CHECK ((state = 'Active') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state = 'Active' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state IN ('Completed','Dead','Cancelled')) = (completed_at IS NOT NULL))
);
CREATE TABLE "attempt_fixture"."artifacts" (
  job_id text PRIMARY KEY REFERENCES "attempt_fixture"."tasks"(id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
  projection bytea NOT NULL CHECK (octet_length(projection) BETWEEN 1 AND 65536)
);
CREATE INDEX "tasks_085154084c742759_due" ON "attempt_fixture"."tasks" (queue, kind, version, available_at, id)
  WHERE state IN ('Pending','RetryScheduled');
CREATE INDEX "tasks_085154084c742759_expired" ON "attempt_fixture"."tasks" (lease_expires_at, id) WHERE state = 'Active';
CREATE INDEX "tasks_085154084c742759_terminal" ON "attempt_fixture"."tasks" (cleanup_at, id) WHERE state IN ('Completed','Dead');
CREATE INDEX "tasks_085154084c742759_source" ON "attempt_fixture"."tasks" (source_job_id) WHERE source_job_id IS NOT NULL;
