import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobPage, type JobFilters } from "@effect-jobs/playground-contracts/Jobs"
import * as Queries from "../../../playground-worker/src/persistence/read/Queries.js"
import * as Read from "../../src/server/read/PostgreSqlRead.js"
import { CursorCodec } from "../../src/server/read/CursorCodec.js"

const mapping = {
  schema: "read_test",
  jobsTable: "jobs",
  sandboxesTable: "sandboxes",
  associationsTable: "associations"
}
const position = {
  version: 1 as const,
  sandbox: Fixtures.sandbox.ref,
  filters: {},
  after: "demo-job-a"
}
const codec = CursorCodec.of({
  encode: () => Effect.succeed("signed-next"),
  decode: () => Effect.succeed(position)
})
const read = (rows: unknown, filters: JobFilters = {}, cursor?: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Read.make(mapping)
      return yield* service.list(
        { sandbox: Fixtures.sandbox },
        {
          sandbox: Fixtures.sandbox.ref,
          filters,
          limit: 20,
          ...(cursor === undefined ? {} : { cursor })
        }
      )
    }).pipe(
      Effect.provideService(Read.ReadDatabase, { execute: () => Effect.succeed(rows) }),
      Effect.provideService(CursorCodec, codec),
      Effect.catchTag("PlaygroundError", (error) => Effect.succeed(error.code))
    )
  )

describe("same-snapshot scoped filtered pagination metadata", () => {
  it.each([
    {},
    { state: "Completed" as const },
    { name: "playground.scenario" },
    { state: "Completed" as const, name: "playground.scenario" }
  ])("counts all matching scoped rows before cursor filtering: %j", (filters) => {
    const query = Queries.make(mapping).list(
      Fixtures.sandbox.ref,
      { sandbox: Fixtures.sandbox.ref, filters, limit: 20 },
      "anchor"
    )
    expect(query.values).toEqual([
      Fixtures.sandbox.ref.sandboxId,
      1,
      filters.state ?? null,
      filters.name ?? null,
      "anchor",
      21
    ])
    const filtered = query.text.slice(
      query.text.indexOf("filtered AS ("),
      query.text.indexOf(") SELECT", query.text.indexOf("filtered AS ("))
    )
    expect(filtered).toContain("count(*)")
    expect(query.text).toContain("a.sandbox_id=$1 AND a.generation=$2")
    expect(query.text).toContain("(SELECT code FROM status)='ok'")
    expect(filtered).toContain("j.state=$3")
    expect(filtered).toContain("j.kind=$4")
    expect(filtered).not.toContain("$5")
    const totals = query.text.slice(
      query.text.indexOf(") SELECT", query.text.indexOf("filtered AS ("))
    )
    expect(totals).not.toContain("j.state=$3")
    expect(totals).not.toContain("j.kind=$4")
    expect(query.text).toContain(
      '(SELECT n FROM filtered)::double precision AS "filteredTotal"'
    )
    expect(query.text).toContain('j.id COLLATE "C">$5 COLLATE "C"')
    expect(query.text).not.toContain("OFFSET")
  })

  it("retains filtered cardinality even on an empty cursor page and preserves global stats", async () => {
    const result = await read(
      [
        {
          status: "ok",
          items: [],
          filteredTotal: 50,
          attentionStats: Fixtures.page.attentionStats,
          stats: Fixtures.page.stats
        }
      ],
      {},
      "signed-cursor"
    )
    expect(result).toMatchObject({
      items: [],
      nextCursor: null,
      filteredTotal: 50,
      attentionStats: Fixtures.page.attentionStats,
      stats: Fixtures.page.stats
    })
    expect(
      await read(
        [
          {
            status: "ok",
            items: [],
            filteredTotal: 0,
            attentionStats: Fixtures.page.attentionStats,
            stats: Fixtures.page.stats
          }
        ],
        { state: "Dead" }
      )
    ).toMatchObject({ filteredTotal: 0, stats: { total: 1 } })
  })

  it.each([-1, 1.5, NaN, Infinity, "50", undefined])(
    "rejects invalid filteredTotal %s at contract and SQL-output boundaries",
    async (filteredTotal) => {
      expect(Schema.is(JobPage)({ ...Fixtures.page, filteredTotal })).toBe(false)
      expect(
        await read([
          {
            status: "ok",
            items: [],
            filteredTotal,
            attentionStats: Fixtures.page.attentionStats,
            stats: Fixtures.page.stats
          }
        ])
      ).toBe("unavailable")
    }
  )

  it("rejects foreign filter cursor before querying and refuses expired authority", async () => {
    expect(
      await read(
        [
          {
            status: "ok",
            items: [],
            filteredTotal: 0,
            attentionStats: Fixtures.page.attentionStats,
            stats: Fixtures.page.stats
          }
        ],
        { state: "Dead" },
        "signed-cursor"
      )
    ).toBe("invalid-request")
    expect(
      await read([
        {
          status: "sandbox-expired",
          items: [],
          filteredTotal: 0,
          attentionStats: Fixtures.page.attentionStats,
          stats: Fixtures.page.stats
        }
      ])
    ).toBe("sandbox-expired")
    expect(
      await read([
        {
          status: "stale-generation",
          items: [],
          filteredTotal: 0,
          attentionStats: Fixtures.page.attentionStats,
          stats: Fixtures.page.stats
        }
      ])
    ).toBe("stale-generation")
  })
})
