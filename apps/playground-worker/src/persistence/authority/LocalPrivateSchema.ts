import { relations } from "./Schema.js"
import { maxRetainedJobs } from "../../demo/Traffic.js"

// Additive migration; historical descriptors and all retained rows remain intact.
export const proposal = (schema: string) => {
  const t = relations(schema)
  // v3's check references retained_jobs AND demo_owned, so PostgreSQL names it sandboxes_check.
  return `ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_check;
    ALTER TABLE ${t.sandboxes} ALTER COLUMN retained_jobs TYPE bigint;
    ALTER TABLE ${t.sandboxes} ADD CONSTRAINT sandboxes_retained_jobs_check
      CHECK (retained_jobs BETWEEN 0 AND 9007199254740991
        AND (NOT demo_owned OR retained_jobs<=${maxRetainedJobs}));`
}
