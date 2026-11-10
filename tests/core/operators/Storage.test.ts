import { expect, test } from "vitest"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"
import * as Storage from "../../../src/PostgreSqlSchema.js"
import { makeJobTables } from "../../../src/PostgreSqlDrizzleSchema.js"

test.each([
  {},
  { schema: "repair_scope", jobsTable: "repair_jobs", payloadsTable: "repair_payloads" },
  { schema: "s".repeat(63), jobsTable: "j".repeat(63), payloadsTable: "p".repeat(63) }
])("fresh SQL, additive DDL and Drizzle agree for %j", (options) => {
  const mapping = Storage.tables(options)
  const rel = Storage.relations(mapping)
  const fresh = Storage.migration(mapping)
  const additive = Storage.lineageMigration(mapping)
  const config = getTableConfig(makeJobTables(mapping).jobs)
  expect(config.columns.slice(-3).map((c) => [c.name, c.notNull])).toEqual([
    ["original_source_job_id", false],
    ["source_job_id", false],
    ["redrive_kind", false]
  ])
  expect(config.foreignKeys).toHaveLength(1)
  const fk = config.foreignKeys[0]!
  expect(fk.onDelete).toBe("set null")
  expect(fk.reference().columns.map((c) => c.name)).toEqual(["source_job_id"])
  expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(["id"])
  expect(getTableConfig(fk.reference().foreignTable).name).toBe(mapping.jobsTable)
  expect(fresh).toContain(`REFERENCES ${rel.jobs}(id) ON DELETE SET NULL`)
  expect(additive).toContain(`REFERENCES ${rel.jobs}(id) ON DELETE SET NULL`)
  expect(additive).not.toContain("CASCADE")
  expect(additive).not.toContain("UPDATE")
  const dialect = new PgDialect()
  for (const check of config.checks.filter((c) =>
    /_(lineage|edge_kind|edge_id|edge_live)$/.test(c.name)
  )) {
    expect(Buffer.byteLength(check.name)).toBeLessThanOrEqual(63)
    const text = dialect
      .sqlToQuery(check.value)
      .sql.replace(/"[a-z_][a-z0-9_]*"\./g, "")
      .replaceAll('"', "")
      .replace(/\s/g, "")
    expect(fresh.replace(/\s/g, "")).toContain(text)
    expect(additive.replace(/\s/g, "")).toContain(text)
  }
  const sourceIndex = config.indexes.find((i) => i.config.name?.endsWith("_source"))!
  expect(sourceIndex).toBeDefined()
  expect(Buffer.byteLength(sourceIndex.config.name!)).toBeLessThanOrEqual(63)
  expect(fresh).toContain(
    `CREATE INDEX "${sourceIndex.config.name}" ON ${rel.jobs} (source_job_id) WHERE source_job_id IS NOT NULL`
  )
})

// This introspection fixture tests readiness refusal, not SQL execution.
