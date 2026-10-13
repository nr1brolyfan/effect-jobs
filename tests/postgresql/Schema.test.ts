import { describe, expect, test } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { makeJobTables } from "../../src/PostgreSqlDrizzleSchema.js"
import * as Schema from "../../src/PostgreSqlSchema.js"

describe("optional fixed Drizzle declarations", () => {
  test("default public schema and configurable namespace match runtime mapping", () => {
    const defaults = makeJobTables()
    expect(defaults.mapping).toEqual(Schema.tables())
    expect(getTableConfig(defaults.jobs).schema).toBeUndefined()
    const custom = makeJobTables({
      schema: "billing",
      jobsTable: "tasks",
      payloadsTable: "artifacts"
    })
    const jobs = getTableConfig(custom.jobs)
    const payloads = getTableConfig(custom.payloads)
    expect(jobs.schema).toBe("billing")
    expect(jobs.name).toBe("tasks")
    expect(jobs.columns.map((c) => c.name)).toEqual([
      "id",
      "operation",
      "operation_id",
      "slot",
      "queue",
      "kind",
      "version",
      "policy",
      "initial_available_at",
      "state",
      "available_at",
      "updated_at",
      "attempts_made",
      "stalled_count",
      "lifecycle_version",
      "lease_token",
      "lease_expires_at",
      "completed_at",
      "last_failure_code",
      "cleanup_at"
    ])
    expect(jobs.uniqueConstraints.map((u) => u.columns.map((c) => c.name))).toEqual([
      ["operation", "operation_id", "slot"],
      ["lease_token"]
    ])
    expect(jobs.indexes).toHaveLength(3)
    expect(jobs.checks).toHaveLength(7)
    expect(payloads.columns.map((c) => c.name)).toEqual([
      "job_id",
      "format_version",
      "payload",
      "projection"
    ])
    expect(payloads.foreignKeys).toHaveLength(1)
    expect(payloads.foreignKeys[0]?.onDelete).toBe("cascade")
    expect(payloads.checks).toHaveLength(2)
  })
  test("invalid/colliding names fail before SQL; long index names retain identity", () => {
    expect(() => Schema.tables({ schema: 'public";DROP SCHEMA public' })).toThrow()
    expect(() => makeJobTables({ jobsTable: "same", payloadsTable: "same" })).toThrow()
    const a = Schema.tables({ jobsTable: "a".repeat(62) + "b" })
    const b = Schema.tables({ jobsTable: "a".repeat(62) + "c" })
    expect(Schema.indexPrefix(a)).not.toBe(Schema.indexPrefix(b))
    expect((Schema.indexPrefix(a) + "_terminal").length).toBeLessThanOrEqual(63)
  })
})
