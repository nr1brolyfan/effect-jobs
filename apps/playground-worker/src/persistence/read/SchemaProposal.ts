// PROPOSAL ONLY: the serial migration owner must reconcile this with authority,
// scenarios and receipt mappings before registering a migration. Never run on import.
import type { Mapping } from "./Queries.js"
import { make } from "./Queries.js"
export const proposal = (mapping: Mapping): string => {
  make(mapping) // Validate all trusted configuration identifiers.
  const relation = (table: string) => `"${mapping.schema}"."${table}"`
  return `CREATE TABLE ${relation(mapping.sandboxesTable)} (
    sandbox_id text PRIMARY KEY CHECK (length(sandbox_id) BETWEEN 1 AND 128),
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    expires_at bigint NOT NULL CHECK (expires_at BETWEEN 1 AND 253402300799999)
  );
  CREATE TABLE ${relation(mapping.associationsTable)} (
    sandbox_id text NOT NULL REFERENCES ${relation(mapping.sandboxesTable)}(sandbox_id),
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    job_id text NOT NULL UNIQUE REFERENCES ${relation(mapping.jobsTable)}(id),
    relations jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(relations)='object'),
    PRIMARY KEY (sandbox_id,generation,job_id)
  );`
}
