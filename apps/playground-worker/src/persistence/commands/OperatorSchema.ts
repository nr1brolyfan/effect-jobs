import { relations } from "../authority/Schema.js"

// App-only v4 fragment. The central registrar appends this together with the
// library's explicit operatorMigration once the exact B commit is integrated.
export const proposal = (schema: string): string => {
  const t = relations(schema)
  const lineage = `"${schema}"."operator_redrives"`
  return `ALTER TABLE ${t.admission} ADD COLUMN operator_command text;
ALTER TABLE ${t.admission} ADD CONSTRAINT operator_command_required
  CHECK ((operation='Operator') = (operator_command IS NOT NULL));
ALTER TABLE ${t.admission} ADD CONSTRAINT operator_command_bounded
  CHECK (operator_command IS NULL OR octet_length(operator_command) BETWEEN 1 AND 4096);
CREATE TABLE ${lineage} (
  sandbox_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  operation text NOT NULL DEFAULT 'Operator' CHECK (operation='Operator'),
  source_job_id text NOT NULL,
  source_state text NOT NULL CHECK (source_state IN ('Dead','Isolated')),
  source_lifecycle_version bigint NOT NULL CHECK (source_lifecycle_version BETWEEN 0 AND 9007199254740991),
  successor_job_id text NOT NULL UNIQUE,
  observed_at bigint NOT NULL CHECK (observed_at BETWEEN 1 AND 253402300799999),
  PRIMARY KEY (sandbox_id,generation,request_id),
  CHECK (source_job_id<>successor_job_id),
  FOREIGN KEY (sandbox_id,generation,source_job_id)
    REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE RESTRICT,
  FOREIGN KEY (sandbox_id,generation,successor_job_id)
    REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE RESTRICT,
  FOREIGN KEY (sandbox_id,generation,operation,request_id)
    REFERENCES ${t.receipts}(sandbox_id,generation,operation,request_id) ON DELETE RESTRICT
);`
}
