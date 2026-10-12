import { Effect, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobDetail, JobPage } from "@effect-jobs/playground-contracts/Jobs"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type { Client } from "./Adapter.js"

// UI-only metadata. No durable enqueue, reset, provider or authority implementation.
const items = Array.from({ length: 13 }, (_, index) => {
  const state =
    (["Pending", "Active", "Completed", "Dead", "Isolated"] as const)[index % 5] ??
    "Pending"
  return {
    ...Fixtures.detail.job,
    jobId: `demo-job-${String(index + 1).padStart(2, "0")}`,
    state,
    availableAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    completedAt: state === "Completed" || state === "Dead" ? 1_700_000_001_000 : null,
    attemptsMade: state === "Pending" ? 0 : 1
  }
})
export const page = Schema.decodeUnknownSync(JobPage)(
  {
    ...Fixtures.page,
    items,
    stats: {
      total: items.length,
      Pending: 3,
      Active: 3,
      Completed: 3,
      Dead: 2,
      Isolated: 2,
      RetryScheduled: 0
    }
  },
  { onExcessProperty: "error" }
)

const check = (ref: SandboxRef) =>
  ref.sandboxId !== Fixtures.sandbox.ref.sandboxId
    ? Effect.fail(new PlaygroundError({ code: "not-found" }))
    : ref.generation !== Fixtures.sandbox.ref.generation
      ? Effect.fail(new PlaygroundError({ code: "stale-generation" }))
      : Effect.void

export const client: Client = {
  source: "mock",
  describe: () => Effect.succeed(Fixtures.sandbox),
  list: (request) =>
    Effect.gen(function* () {
      yield* check(request.sandbox)
      const filtered = page.items.filter(
        (job) =>
          (request.filters.state === undefined || job.state === request.filters.state) &&
          (request.filters.kind === undefined ||
            job.catalog.kind === request.filters.kind)
      )
      const start =
        request.cursor === undefined
          ? 0
          : filtered.findIndex((job) => job.jobId === request.cursor) + 1
      if (request.cursor !== undefined && start === 0) {
        return yield* new PlaygroundError({ code: "invalid-request" })
      }
      const visible = filtered.slice(start, start + request.limit)
      return {
        sandbox: request.sandbox,
        items: visible,
        stats: page.stats,
        nextCursor:
          start + request.limit < filtered.length ? (visible.at(-1)?.jobId ?? null) : null
      }
    }),
  detail: (request) =>
    Effect.gen(function* () {
      yield* check(request.sandbox)
      const job = page.items.find((candidate) => candidate.jobId === request.jobId)
      if (job === undefined) {
        return yield* new PlaygroundError({ code: "not-found" })
      }
      return yield* Schema.decodeUnknownEffect(JobDetail)(
        {
          ...Fixtures.detail,
          job,
          observation: {
            ...Fixtures.detail.observation,
            observedAt: job.updatedAt,
            outcome:
              job.state === "Active"
                ? "unknown"
                : job.state === "Dead"
                  ? "dead"
                  : job.state === "Isolated"
                    ? "isolated"
                    : job.state === "Pending"
                      ? "retry"
                      : "success"
          }
        },
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    }),
  run: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  reset: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  scenarioReceipt: () => Effect.fail(new PlaygroundError({ code: "not-found" })),
  resetReceipt: () => Effect.fail(new PlaygroundError({ code: "not-found" }))
}
