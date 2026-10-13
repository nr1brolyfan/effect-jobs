import { describe, expect, it } from "vitest"
import { Effect, Exit, Schema } from "effect"
import { Cursor } from "@effect-jobs/playground-contracts/Jobs"
import * as Codec from "../../../src/server/read/CursorCodec.js"
import * as Read from "../../../src/server/read/PostgreSqlRead.js"
import * as Fixture from "../../../../playground-worker/tests/repairs/Fixtures.js"

const access = {
  sandbox: {
    ref: Fixture.ref,
    expiresAt: 100000,
    capabilities: {
      runScenario: false,
      resetSandbox: false,
      retryJob: false,
      cancelJob: false,
      redriveJob: false
    }
  }
}
const mapping = {
  schema: "repair_test",
  jobsTable: "jobs",
  sandboxesTable: "sandboxes",
  associationsTable: "sandbox_jobs"
}
const make = async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(37),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
  const codec = Codec.make(key)
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = []
  const rows = [
    {
      status: "ok",
      items: [
        {
          problem: { ...Fixture.problem, state: "Open", activeSuccessorJobId: null },
          representative: null
        }
      ],
      filteredTotal: 7,
      stats: {
        total: 0,
        Pending: 0,
        RetryScheduled: 0,
        Active: 0,
        Completed: 0,
        Cancelled: 0,
        Dead: 0,
        Isolated: 0
      },
      attentionStats: { Open: 7, InProgress: 0, Resolved: 0, needsAttention: 7 }
    }
  ]
  const service = await Effect.runPromise(
    Read.make(mapping).pipe(
      Effect.provideService(Codec.CursorCodec, codec),
      Effect.provideService(Read.ReadDatabase, {
        execute: (query) =>
          Effect.sync(() => {
            calls.push(query)
            return rows
          })
      })
    )
  )
  return { service, codec, calls }
}

describe("scoped authenticated read positions", () => {
  it("rejects changed signatures and preserves v2 purpose", async () => {
    const { codec } = await make()
    const cursor = await Effect.runPromise(
      codec.encode({
        version: 2,
        view: "history",
        sandbox: Fixture.ref,
        jobId: Fixture.sourceId,
        after: "fact-1"
      })
    )
    expect(await Effect.runPromise(codec.decode(cursor))).toMatchObject({
      view: "history",
      jobId: Fixture.sourceId
    })
    const parts = cursor.split(".")
    const changed = Schema.decodeSync(Cursor)(
      `${parts[0]}.${parts[1]![0] === "A" ? "B" : "A"}${parts[1]!.slice(1)}`
    )
    expect(Exit.isFailure(await Effect.runPromiseExit(codec.decode(changed)))).toBe(true)
  })
  it.each(["jobs", "history", "related"] as const)(
    "rejects %s cursor in problem paging before querying",
    async (view) => {
      const { codec, service, calls } = await make()
      const cursor = await Effect.runPromise(
        codec.encode(
          view === "jobs"
            ? { version: 2, view, sandbox: Fixture.ref, filters: {}, after: "root-a" }
            : {
                version: 2,
                view,
                sandbox: Fixture.ref,
                jobId: Fixture.sourceId,
                after: "fact-a"
              }
        )
      )
      expect(
        Exit.isFailure(
          await Effect.runPromiseExit(
            service.problems(access, {
              sandbox: Fixture.ref,
              filters: {},
              cursor,
              limit: 25
            })
          )
        )
      ).toBe(true)
      expect(calls).toEqual([])
    }
  )
  it("binds resolution filters, generation and related job identity", async () => {
    const { codec, service, calls } = await make()
    const cursor = await Effect.runPromise(
      codec.encode({
        version: 2,
        view: "problems",
        sandbox: Fixture.ref,
        filters: { resolution: "Open" },
        after: "root-a"
      })
    )
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          service.problems(access, {
            sandbox: Fixture.ref,
            filters: { resolution: "Resolved" },
            cursor,
            limit: 25
          })
        )
      )
    ).toBe(true)
    const related = await Effect.runPromise(
      codec.encode({
        version: 2,
        view: "related",
        sandbox: Fixture.ref,
        jobId: Fixture.successorId,
        after: "member-a"
      })
    )
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          service.related(access, {
            sandbox: Fixture.ref,
            jobId: Fixture.sourceId,
            cursor: related,
            limit: 25
          })
        )
      )
    ).toBe(true)
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          service.problems(access, {
            sandbox: { ...Fixture.ref, generation: 2 },
            filters: {},
            limit: 25
          })
        )
      )
    ).toBe(true)
    expect(calls).toEqual([])
  })
  it("returns tombstones separately from lifecycle counts and preserves filteredTotal", async () => {
    const { service, calls } = await make()
    const page = await Effect.runPromise(
      service.problems(access, {
        sandbox: Fixture.ref,
        filters: { resolution: "Open", needsAttention: true },
        limit: 25
      })
    )
    expect(page.items[0]?.representative).toBeNull()
    expect(page.filteredTotal).toBe(7)
    expect(page.stats.total).toBe(0)
    expect(page.attentionStats.needsAttention).toBe(7)
    expect(calls[0]?.values).toEqual([
      Fixture.ref.sandboxId,
      1,
      null,
      null,
      "Open",
      true,
      null,
      26
    ])
  })
})
