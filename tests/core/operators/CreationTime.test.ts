import { Effect, Schema } from "effect"
import { expect, test } from "vitest"
import { JobId } from "../../../src/JobId.js"
import { insertOrCompareAt } from "../../../src/internal/postgresql/Producer.js"
import type { TransactionQuery } from "../../../src/PostgreSqlTransaction.js"
import { prepared } from "../lifecycle/fixtures.js"
import * as Tables from "../../../src/PostgreSqlSchema.js"
import { getTableConfig } from "drizzle-orm/pg-core"
import { makeJobTables } from "../../../src/PostgreSqlDrizzleSchema.js"

test("store insertion stamps DB time separately from future availability and does no duplicate rewrite", async () => {
  const value = {
    ...prepared(),
    encoded: { ...prepared().encoded, formatVersion: 1 as const },
    availableAt: 9_000
  }
  const calls: Array<{ text: string; values: ReadonlyArray<unknown> }> = []
  let exists = false
  const query: TransactionQuery = {
    query: (text, values = []) =>
      Effect.sync(() => {
        calls.push({ text, values })
        if (text.startsWith("INSERT INTO jobs")) {
          return exists ? [] : [{ id: "first" }]
        }
        if (text.startsWith("SELECT j.id")) {
          return [
            {
              id: "first",
              queue: value.catalog.queue,
              kind: value.catalog.kind,
              version: value.catalog.version,
              format_version: 1,
              projection: value.encoded.semanticProjectionBytes,
              original_source_job_id: null,
              source_job_id: null,
              redrive_kind: null
            }
          ]
        }
        return []
      })
  }
  const first = await Effect.runPromise(
    insertOrCompareAt(
      query,
      "jobs",
      "payloads",
      value,
      500,
      Schema.decodeSync(JobId)("first")
    )
  )
  expect(first._tag).toBe("Inserted")
  expect(calls[0]!.text).toContain("redrive_kind,created_at)")
  expect(calls[0]!.text).toContain("$13,$14,$11)")
  expect(calls[0]!.values[9]).toBe(9_000)
  expect(calls[0]!.values[10]).toBe(500)
  exists = true
  calls.length = 0
  const duplicate = await Effect.runPromise(
    insertOrCompareAt(query, "jobs", "payloads", value, 700)
  )
  expect(duplicate).toEqual({ _tag: "AlreadyPresent", jobId: "first" })
  expect(calls).toHaveLength(2)
  expect(calls.every((c) => !c.text.startsWith("UPDATE"))).toBe(true)
})

test.each([{}, { schema: "billing", jobsTable: "tasks", payloadsTable: "artifacts" }])(
  "mapped SQL and Drizzle declare nullable creation metadata without a default %j",
  (options) => {
    const mapping = Tables.tables(options)
    expect(Tables.migration(mapping)).toContain("created_at bigint,")
    expect(Tables.creationTimeMigration(mapping)).toBe(
      `ALTER TABLE ${Tables.relations(mapping).jobs} ADD COLUMN created_at bigint;`
    )
    const column = getTableConfig(makeJobTables(options).jobs).columns.find(
      (c) => c.name === "created_at"
    )!
    expect(column.notNull).toBe(false)
    expect(column.hasDefault).toBe(false)
    expect(column.getSQLType()).toBe("bigint")
  }
)
