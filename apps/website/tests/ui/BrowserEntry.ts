import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"
import * as Mount from "../../src/features/jobs/Mount.js"

// Browser-test harness only. Commands below return scripted test observations,
// never durable execution. The production registrar must not import this module.
let mode: "normal" | "error" | "invalid-cursor" | "empty" | "expired" = "normal"
let generation = 1
let runs = 0
let requests: string[] = []
let updated = false
let describeDelay = 0
let descriptions = 0
const commands = new URLSearchParams(window.location.search).has("commands")
const sandbox = () => ({
  ...Fixtures.sandbox,
  ref: { ...Fixtures.sandbox.ref, generation },
  capabilities: {
    ...Fixtures.sandbox.capabilities,
    runScenario: commands,
    resetSandbox: commands
  }
})
const client: Client = {
  ...FixtureClient.client,
  describe: () => {
    ++descriptions
    return (
      mode === "expired"
        ? Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
        : Effect.succeed(sandbox())
    ).pipe(Effect.delay(describeDelay))
  },
  list: (request) => {
    requests.push(request.cursor ?? "first")
    if (mode === "error") {
      return Effect.fail(new PlaygroundError({ code: "unavailable" }))
    }
    if (mode === "invalid-cursor") {
      return Effect.fail(new PlaygroundError({ code: "invalid-request" }))
    }
    if (mode === "empty" || generation > 1) {
      return Effect.succeed({
        sandbox: request.sandbox,
        items: [],
        nextCursor: null,
        filteredTotal: 0,
        attentionStats: Fixtures.page.attentionStats,
        stats: {
          total: 0,
          Pending: 0,
          RetryScheduled: 0,
          Active: 0,
          Completed: 0,
          Dead: 0,
          Isolated: 0,
          Cancelled: 0
        }
      })
    }
    const items = Array.from({ length: 43 }, (_, index) => {
      const state = (["Pending", "Active", "Completed", "Dead", "Isolated"] as const)[
        index % 5
      ]!
      return {
        ...FixtureClient.page.items[0]!,
        jobId:
          `demo-job-${String(index + 1).padStart(2, "0")}` as typeof Fixtures.detail.job.jobId,
        state: updated && index === 20 ? ("Completed" as const) : state,
        attemptsMade: updated && index === 20 ? 1 : state === "Pending" ? 0 : 1,
        completedAt:
          state === "Completed" || state === "Dead" || (updated && index === 20)
            ? 1_700_000_001_000
            : null,
        lifecycleVersion:
          FixtureClient.page.items[0]!.lifecycleVersion +
          (updated && index === 20 ? 1 : 0)
      }
    })
    const filtered = items.filter(
      (job) => request.filters.state === undefined || request.filters.state === job.state
    )
    const start =
      request.cursor === undefined
        ? 0
        : filtered.findIndex((job) => job.jobId === request.cursor) + 1
    const visible = filtered.slice(start, start + request.limit)
    return Effect.succeed({
      ...FixtureClient.page,
      items: visible,
      sandbox: request.sandbox,
      stats: {
        total: 43,
        Pending: updated ? 8 : 9,
        Active: 9,
        Completed: updated ? 10 : 9,
        Dead: 8,
        Isolated: 8,
        Cancelled: 0,
        RetryScheduled: 0
      },
      filteredTotal: filtered.length,
      nextCursor: start + request.limit < filtered.length ? visible.at(-1)!.jobId : null
    })
  },
  run: (command) => {
    ++runs
    return Effect.succeed({
      _tag: "OutcomeUnknown",
      sandbox: command.sandbox,
      requestId: command.requestId
    })
  },
  scenarioReceipt: () => Effect.fail(new PlaygroundError({ code: "not-found" })),
  reset: (command) => {
    ++generation
    return Effect.succeed({
      _tag: "Committed",
      previous: command.sandbox,
      current: sandbox().ref,
      requestId: command.requestId
    })
  }
}
const root = document.getElementById("jobs")
if (root === null) {
  throw new Error("Missing test mount")
}
const mounted = Mount.mount(root, client, sandbox(), {
  poll: new URLSearchParams(window.location.search).has("poll")
})
const browserTest = {
  mode: (next: typeof mode) => {
    mode = next
  },
  reconcile: () =>
    Effect.runPromise(
      mounted.runtime.refresh.pipe(Effect.provideService(JobsClient, client))
    ),
  next: () => mounted.runtime.run(mounted.runtime.next),
  generation: () => {
    ++generation
  },
  requests: () => requests,
  runs: () => runs,
  clearRequests: () => {
    requests = []
  },
  update: () => {
    updated = true
  },
  snapshot: () => mounted.runtime.snapshot(),
  reading: () => mounted.runtime.reading(),
  descriptions: () => descriptions,
  delayDescribe: (millis: number) => {
    describeDelay = millis
  },
  dispose: mounted.dispose
}
declare global {
  interface Window {
    readonly jobsBrowserTest: typeof browserTest
  }
}
Object.defineProperty(window, "jobsBrowserTest", { value: browserTest })
