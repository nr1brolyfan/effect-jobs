import { createHash } from "node:crypto"
import * as Jobs from "effect-jobs/PostgreSqlSchema"
import * as Authority from "./authority/Schema.js"

// App-owned descriptors. Only explicit setup runs these; never event code.
export interface MigrationDescriptor {
  readonly id: string
  readonly checksum: string
  readonly sql: string
}
export const migrations = (schema: string): ReadonlyArray<MigrationDescriptor> => {
  const sql =
    Jobs.migration(Jobs.tables({ schema })) +
    Authority.proposal(schema) +
    `
    ALTER TABLE "${schema}"."sandboxes"
      ADD CHECK (length(sandbox_id) BETWEEN 1 AND 128),
      ADD CHECK (expires_at BETWEEN 1 AND 253402300799999);
    ALTER TABLE "${schema}"."associations"
      ADD CHECK (generation BETWEEN 1 AND 9007199254740991),
      ADD CHECK (jsonb_typeof(relations)='object');`
  return Object.freeze([
    { id: "playground-v1", sql, checksum: createHash("sha256").update(sql).digest("hex") }
  ])
}
