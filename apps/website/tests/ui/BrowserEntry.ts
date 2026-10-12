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
const commands = window.location.pathname === "/commands"
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
    return FixtureClient.client.list(request).pipe(
      Effect.map((page) => ({
        ...page,
        stats: updated
          ? {
              ...page.stats,
              Pending: page.stats.Pending - 1,
              Completed: page.stats.Completed + 1
            }
          : page.stats,
        items: page.items.map((job) =>
          updated && job.jobId === "demo-job-06"
            ? {
                ...job,
                state: "Completed" as const,
                completedAt: job.updatedAt,
                attemptsMade: 1,
                lifecycleVersion: job.lifecycleVersion + 1
              }
            : job
        )
      }))
    )
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
  poll: window.location.pathname === "/poll"
})
const browserTest = {
  mode: (next: typeof mode) => {
    mode = next
  },
  reconcile: () =>
    Effect.runPromise(
      mounted.runtime.refresh.pipe(Effect.provideService(JobsClient, client))
    ),
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
