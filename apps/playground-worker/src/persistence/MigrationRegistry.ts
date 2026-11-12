import { createHash } from "node:crypto"
import * as LegacyOperatorsV4 from "./LegacyOperatorsV4.js"
import * as Repairs from "./commands/RepairSchema.js"
import * as Operators from "./commands/OperatorSchema.js"
import * as Jobs from "effect-jobs/PostgreSqlSchema"
import * as LegacyJobsV1 from "./LegacyJobsV1.js"
import * as LocalPrivate from "./authority/LocalPrivateSchema.js"
import * as Authority from "./authority/Schema.js"
import * as Demo from "../demo/Schema.js"

// App-owned descriptors. Only explicit setup runs these; never event code.
export interface MigrationDescriptor {
  readonly id: string
  readonly checksum: string
  readonly sql: string
}
export const migrations = (schema: string): ReadonlyArray<MigrationDescriptor> => {
  const sql =
    LegacyJobsV1.migration(Jobs.tables({ schema })) +
    Authority.proposal(schema) +
    `
    ALTER TABLE "${schema}"."sandboxes"
      ADD CHECK (length(sandbox_id) BETWEEN 1 AND 128),
      ADD CHECK (expires_at BETWEEN 1 AND 253402300799999);
    ALTER TABLE "${schema}"."associations"
      ADD CHECK (generation BETWEEN 1 AND 9007199254740991),
      ADD CHECK (jsonb_typeof(relations)='object');`
  const operators =
    LegacyOperatorsV4.operatorMigration(Jobs.tables({ schema })) +
    Operators.proposal(schema)
  const repairs =
    Jobs.lineageMigration(Jobs.tables({ schema })) + Repairs.proposal(schema)
  const creationTime = Jobs.creationTimeMigration(Jobs.tables({ schema }))
  return Object.freeze([
    {
      id: "playground-v1",
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    },
    {
      id: "playground-demo-v2",
      sql: Demo.proposal(schema),
      checksum: createHash("sha256").update(Demo.proposal(schema)).digest("hex")
    },
    {
      id: "playground-demo-volume-v3",
      sql: Demo.volumeProposal(schema),
      checksum: createHash("sha256").update(Demo.volumeProposal(schema)).digest("hex")
    },
    {
      id: "playground-operators-v4",
      sql: operators,
      checksum: createHash("sha256").update(operators).digest("hex")
    },
    {
      id: "playground-local-private-v5",
      sql: LocalPrivate.proposal(schema),
      checksum: createHash("sha256").update(LocalPrivate.proposal(schema)).digest("hex")
    },
    {
      id: "playground-job-repairs-v6",
      sql: repairs,
      checksum: createHash("sha256").update(repairs).digest("hex")
    },
    {
      id: "playground-job-creation-time-v7",
      sql: creationTime,
      checksum: createHash("sha256").update(creationTime).digest("hex")
    }
  ])
}

// Application setup calls this after applying v6 in its own migration transaction.
// No pool or automatic migration runs on module import.
export { run as backfillSyntheticTenants } from "./SyntheticTenantBackfill.js"
