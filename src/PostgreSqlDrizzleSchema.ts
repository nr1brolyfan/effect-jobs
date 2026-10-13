/** Optional migration-only entrypoint. Never imported by core or the PostgreSQL runtime. */
import { Buffer } from "node:buffer"
import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  text,
  unique
} from "drizzle-orm/pg-core"
import type { PgTableFn } from "drizzle-orm/pg-core"
import { indexPrefix, tables, type TableOptions } from "./PostgreSqlSchema.js"
import type { JobPolicy } from "./JobPolicy.js"

const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value)
})
/** Fixed column contract, configurable namespace/relation names, application-owned migrations. */
export const makeJobTables = (options: TableOptions = {}) => {
  const mapping = tables(options)
  const table: PgTableFn<string | undefined> =
    mapping.schema === "public" ? pgTable : pgSchema(mapping.schema).table
  const prefix = indexPrefix(mapping)
  const jobs = table(
    mapping.jobsTable,
    {
      id: text("id").primaryKey(),
      operation: text("operation").notNull(),
      operationId: text("operation_id").notNull(),
      slot: text("slot").notNull(),
      queue: text("queue").notNull(),
      kind: text("kind").notNull(),
      version: integer("version").notNull(),
      policy: jsonb("policy").$type<JobPolicy>().notNull(),
      initialAvailableAt: bigint("initial_available_at", { mode: "number" }),
      state: text("state").notNull(),
      availableAt: bigint("available_at", { mode: "number" }).notNull(),
      updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
      attemptsMade: bigint("attempts_made", { mode: "number" }).notNull().default(0),
      stalledCount: bigint("stalled_count", { mode: "number" }).notNull().default(0),
      lifecycleVersion: bigint("lifecycle_version", { mode: "number" })
        .notNull()
        .default(0),
      leaseToken: text("lease_token"),
      leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
      completedAt: bigint("completed_at", { mode: "number" }),
      lastFailureCode: text("last_failure_code"),
      cleanupAt: bigint("cleanup_at", { mode: "number" })
    },
    (j) => [
      unique().on(j.operation, j.operationId, j.slot),
      unique().on(j.leaseToken),
      check(
        `${prefix}_state`,
        sql`${j.state} IN ('Pending','Active','RetryScheduled','Completed','Dead','Isolated')`
      ),
      check(`${prefix}_attempts`, sql`${j.attemptsMade} >= 0`),
      check(`${prefix}_stalls`, sql`${j.stalledCount} >= 0`),
      check(`${prefix}_version`, sql`${j.lifecycleVersion} >= 0`),
      check(
        `${prefix}_active`,
        sql`(${j.state} = 'Active') = (${j.leaseToken} IS NOT NULL AND ${j.leaseExpiresAt} IS NOT NULL)`
      ),
      check(
        `${prefix}_unowned`,
        sql`${j.state} = 'Active' OR (${j.leaseToken} IS NULL AND ${j.leaseExpiresAt} IS NULL)`
      ),
      check(
        `${prefix}_completed`,
        sql`(${j.state} IN ('Completed','Dead')) = (${j.completedAt} IS NOT NULL)`
      ),
      index(`${prefix}_due`)
        .on(j.queue, j.kind, j.version, j.availableAt, j.id)
        .where(sql`${j.state} IN ('Pending','RetryScheduled')`),
      index(`${prefix}_expired`)
        .on(j.leaseExpiresAt, j.id)
        .where(sql`${j.state} = 'Active'`),
      index(`${prefix}_terminal`)
        .on(j.cleanupAt, j.id)
        .where(sql`${j.state} IN ('Completed','Dead')`)
    ]
  )
  const payloads = table(
    mapping.payloadsTable,
    {
      jobId: text("job_id")
        .primaryKey()
        .references(() => jobs.id, { onDelete: "cascade" }),
      formatVersion: integer("format_version").notNull(),
      payload: bytes("payload").notNull(),
      projection: bytes("projection").notNull()
    },
    (p) => [
      check(
        `${mapping.payloadsTable.slice(0, 45)}_payload`,
        sql`octet_length(${p.payload}) BETWEEN 1 AND 65536`
      ),
      check(
        `${mapping.payloadsTable.slice(0, 45)}_projection`,
        sql`octet_length(${p.projection}) BETWEEN 1 AND 65536`
      )
    ]
  )
  return Object.freeze({ mapping, jobs, payloads })
}
