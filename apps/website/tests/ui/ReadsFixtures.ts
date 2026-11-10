import { Effect, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobId } from "effect-jobs/JobId"
import { JobPage, type ListJobs } from "@effect-jobs/playground-contracts/Jobs"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import type { Client } from "../../src/features/jobs/Adapter.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"

// Synthetic keyset server: ordering, filters and global totals share one read.
// Mutating this test dataset represents inserts/deletes between requests.
export const makeServer = () => {
  let items = Array.from({ length: 65 }, (_, index) => ({
    ...Fixtures.detail.job,
    jobId: Schema.decodeSync(JobId)(`read-job-${String(index).padStart(3, "0")}`),
    state: "Pending" as const,
    completedAt: null,
    attemptsMade: 0
  }))
  const requests: Array<ListJobs> = []
  const client: Client = {
    ...FixtureClient.client,
    list: (request) =>
      Effect.sync(() => {
        requests.push(request)
        const filtered = items.filter(
          (job) =>
            (request.filters.state === undefined ||
              job.state === request.filters.state) &&
            (request.filters.name === undefined ||
              job.catalog.name === request.filters.name)
        )
        const remaining = filtered.filter(
          (job) => request.cursor === undefined || job.jobId > request.cursor
        )
        const visible = remaining.slice(0, request.limit)
        return Schema.decodeSync(JobPage)({
          sandbox: request.sandbox,
          items: visible,
          filteredTotal: filtered.length,
          nextCursor: remaining.length > request.limit ? visible.at(-1)!.jobId : null,
          attentionStats: Fixtures.page.attentionStats,
          stats: {
            total: items.length,
            Pending: items.length,
            Active: 0,
            Completed: 0,
            Dead: 0,
            Isolated: 0,
            Cancelled: 0,
            RetryScheduled: 0
          }
        })
      }),
    detail: (request) => {
      const job = items.find((item) => item.jobId === request.jobId)
      return job === undefined
        ? Effect.fail(new PlaygroundError({ code: "not-found" }))
        : Effect.succeed({ ...Fixtures.detail, sandbox: request.sandbox, job })
    }
  }
  return {
    client,
    requests,
    keep: (count: number) => {
      items = items.slice(0, count)
    },
    removeFirst: () => {
      items = items.slice(1)
    },
    insertFirst: () => {
      items = [
        { ...items[0]!, jobId: Schema.decodeSync(JobId)("read-job--new") },
        ...items
      ]
    }
  }
}
