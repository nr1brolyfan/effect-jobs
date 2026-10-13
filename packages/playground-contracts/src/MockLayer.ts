import { Clock, Effect, Layer } from "effect"
import { Changes, JobsRead, PlaygroundError, Scenarios } from "./Services.js"
import type { SandboxAccess, SandboxRef } from "./Sandbox.js"
import * as Fixtures from "./Fixtures.js"

// Fixture adapter for UI/transport development. No authority or durable execution.
const authorize = Effect.fnUntraced(function* (
  access: SandboxAccess,
  requested: SandboxRef
) {
  const actual = access.sandbox.ref
  if (
    actual.sandboxId !== Fixtures.sandbox.ref.sandboxId ||
    requested.sandboxId !== actual.sandboxId
  ) {
    return yield* new PlaygroundError({ code: "not-found" })
  }
  if (
    actual.generation !== Fixtures.sandbox.ref.generation ||
    requested.generation !== actual.generation
  ) {
    return yield* new PlaygroundError({ code: "stale-generation" })
  }
  if (
    (yield* Clock.currentTimeMillis) >=
    Math.min(access.sandbox.expiresAt, Fixtures.sandbox.expiresAt)
  ) {
    return yield* new PlaygroundError({ code: "sandbox-expired" })
  }
})
export const layer = Layer.mergeAll(
  Layer.succeed(
    JobsRead,
    JobsRead.of({
      list: Effect.fn("MockJobsRead.list")(function* (access, request) {
        yield* authorize(access, request.sandbox)
        if (request.cursor !== undefined) {
          return yield* new PlaygroundError({ code: "invalid-request" })
        }
        const items = Fixtures.page.items.filter(
          (job) =>
            (request.filters.state === undefined ||
              request.filters.state === job.state) &&
            (request.filters.kind === undefined ||
              request.filters.kind === job.catalog.kind)
        )
        return {
          ...Fixtures.page,
          filteredTotal: items.length,
          items: items.slice(0, request.limit)
        }
      }),
      problems: () =>
        Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
      history: () => Effect.succeed(Fixtures.detail.history),
      related: () => Effect.succeed(Fixtures.detail.related),
      detail: Effect.fn("MockJobsRead.detail")(function* (access, request) {
        yield* authorize(access, request.sandbox)
        if (request.jobId !== Fixtures.detail.job.jobId) {
          return yield* new PlaygroundError({ code: "not-found" })
        }
        return Fixtures.detail
      })
    })
  ),
  Layer.succeed(
    Scenarios,
    Scenarios.of({
      run: Effect.fn("MockScenarios.run")(function* (access, command) {
        yield* authorize(access, command.sandbox)
        return yield* new PlaygroundError({ code: "capability-unavailable" })
      }),
      scenarioReceipt: Effect.fn("MockScenarios.scenarioReceipt")(
        function* (access, request) {
          yield* authorize(access, request.sandbox)
          return yield* new PlaygroundError({ code: "not-found" })
        }
      ),
      resetReceipt: Effect.fn("MockScenarios.resetReceipt")(function* (access, request) {
        yield* authorize(access, request.sandbox)
        return yield* new PlaygroundError({ code: "not-found" })
      }),
      reset: Effect.fn("MockScenarios.reset")(function* (access, command) {
        yield* authorize(access, command.sandbox)
        return yield* new PlaygroundError({ code: "capability-unavailable" })
      })
    })
  ),
  Layer.succeed(
    Changes,
    Changes.of({
      read: Effect.fn("MockChanges.read")(function* (access, request) {
        yield* authorize(access, request.sandbox)
        return {
          sandbox: Fixtures.sandbox.ref,
          mode: "poll-only" as const,
          reconcile: true,
          hints: []
        }
      })
    })
  )
)
