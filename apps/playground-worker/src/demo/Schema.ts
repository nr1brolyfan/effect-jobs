import { relations } from "../persistence/authority/Schema.js"
import { maxRetainedJobs } from "./Traffic.js"

export const proposal = (schema: string) => {
  const t = relations(schema)
  return `ALTER TABLE ${t.sandboxes} ADD COLUMN demo_owned boolean NOT NULL DEFAULT false;
    ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_retained_jobs_check;
    ALTER TABLE ${t.sandboxes} ADD CHECK (retained_jobs BETWEEN 0 AND 3000);
    CREATE TABLE "${schema}"."demo_control" (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      current_id text REFERENCES ${t.sandboxes}(sandbox_id),
      candidate_id text REFERENCES ${t.sandboxes}(sandbox_id),
      rotate_at bigint NOT NULL DEFAULT 0,
      next_tick bigint NOT NULL DEFAULT 0,
      sequence bigint NOT NULL DEFAULT 0
    );
    INSERT INTO "${schema}"."demo_control"(singleton) VALUES(true);`
}
export const volumeProposal = (schema: string) => {
  const t = relations(schema)
  return `ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_retained_jobs_check;
    ALTER TABLE ${t.sandboxes} ADD CHECK (retained_jobs BETWEEN 0 AND ${maxRetainedJobs} AND (demo_owned OR retained_jobs<=100));`
}
