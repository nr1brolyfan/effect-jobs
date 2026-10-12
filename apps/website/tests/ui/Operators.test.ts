import { describe, expect, it } from "vitest"
import { Deferred, Effect, Fiber, Schema } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { JobId } from "effect-jobs/JobId"
import { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type {
  JobOperatorCommand,
  JobOperatorResult
} from "@effect-jobs/playground-contracts/Operators"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"

const sandbox = {
  ...Fixtures.sandbox,
  capabilities: {
    ...Fixtures.sandbox.capabilities,
    redriveJob: true,
    cancelJob: true,
    retryJob: true
  }
}
const source = Schema.decodeUnknownSync(JobDetail)({
  ...Fixtures.detail,
  job: { ...Fixtures.detail.job, state: "Dead" }
})
const committed = (command: JobOperatorCommand): JobOperatorResult => ({
  _tag: "Committed",
  sandbox: command.sandbox,
  requestId: command.requestId,
  action: command.action,
  sourceJobId: command.jobId,
  sourceState: command.expectedState,
  sourceLifecycleVersion: command.expectedLifecycleVersion,
  resultJobId: Schema.decodeSync(JobId)(source.job.jobId + "-successor"),
  resultState: "Pending",
  resultLifecycleVersion: 0,
  observedAt: source.job.updatedAt
})
const run = <A, E>(operation: Effect.Effect<A, E, JobsClient>, client: Client) =>
  Effect.runPromise(operation.pipe(Effect.provideService(JobsClient, client)))
const setup = () => {
  const controller = Atoms.make(sandbox)
  const calls: JobOperatorCommand[] = []
  const receipts: string[] = []
  const client: Client = {
    ...FixtureClient.client,
    describe: () => Effect.succeed(sandbox),
    detail: () => Effect.succeed(source),
    operate: (command) =>
      Effect.sync(() => {
        calls.push(command)
        return {
          _tag: "OutcomeUnknown" as const,
          sandbox: command.sandbox,
          requestId: command.requestId
        }
      }),
    operatorReceipt: (request) =>
      Effect.sync(() => {
        receipts.push(request.requestId)
        return committed(calls[0]!)
      })
  }
  return { controller, calls, receipts, client }
}

describe("Atoms operator request ownership", () => {
  it("retains one exact immutable unknown command and reconciles without replay", async () => {
    const { controller, calls, receipts, client } = setup()
    await run(controller.select(source.job.jobId), client)
    await run(controller.operate("redrive", "redrive-a", true), client)
    const pending = controller.snapshot().pending
    expect(pending?.kind).toBe("operator")
    expect(calls).toHaveLength(1)
    expect(Object.isFrozen(calls[0])).toBe(true)
    expect(Object.isFrozen(calls[0]!.sandbox)).toBe(true)
    await run(controller.operate("redrive", "redrive-b", true), client)
    await run(controller.command("reset", "reset-a", "success", 1), client)
    expect(calls).toHaveLength(1)
    expect(controller.snapshot().pending).toBe(pending)
    await run(controller.receipt, client)
    expect(receipts).toEqual(["redrive-a"])
    expect(calls).toHaveLength(1)
    expect(controller.snapshot().pending).toBeUndefined()
    // Acknowledgement never replaces the original row with a fabricated successor.
    expect(controller.snapshot().detail?.job).toEqual(source.job)
    expect(controller.snapshot().notice).toContain("Handler success is not confirmed")
    expect(controller.snapshot().loading).toBe(false)
    controller.dispose()
  })
  it("keeps pending identity on a mismatched receipt", async () => {
    const { controller, calls, client } = setup()
    await run(controller.select(source.job.jobId), client)
    await run(controller.operate("redrive", "redrive-a", true), client)
    const pending = controller.snapshot().pending
    await run(controller.receipt, {
      ...client,
      operatorReceipt: () =>
        Effect.succeed({ ...committed(calls[0]!), requestId: "wrong" })
    })
    expect(controller.snapshot().pending).toBe(pending)
    expect(controller.snapshot().notice).toContain("Absence does not authorize replay")
    controller.dispose()
  })
  it("clears a definitive rejection without changing the source", async () => {
    const { controller, client } = setup()
    await run(controller.select(source.job.jobId), client)
    await run(controller.operate("redrive", "redrive-a", true), {
      ...client,
      operate: (command) =>
        Effect.succeed({
          _tag: "Rejected",
          sandbox: command.sandbox,
          requestId: command.requestId,
          action: command.action,
          jobId: command.jobId,
          reason: "invalid-artifact"
        })
    })
    expect(controller.snapshot().pending).toBeUndefined()
    expect(controller.snapshot().detail?.job).toEqual(source.job)
    expect(controller.snapshot().notice).toContain("No job was changed")
    controller.dispose()
  })
  it("does not dispatch unconfirmed redrive or unavailable Active cancellation", async () => {
    const { controller, calls, client } = setup()
    await run(controller.select(source.job.jobId), client)
    await run(controller.operate("redrive", "redrive-a"), client)
    expect(calls).toHaveLength(0)
    expect(controller.snapshot().pending).toBeUndefined()
    const active = {
      ...source,
      job: { ...source.job, state: "Active" as const, completedAt: null }
    }
    await run(controller.select(source.job.jobId), {
      ...client,
      detail: () => Effect.succeed(active)
    })
    await run(controller.operate("cancel", "cancel-a"), client)
    expect(calls).toHaveLength(0)
    expect(controller.snapshot().notice).toContain("handler may already be executing")
    controller.dispose()
  })
  it("drops late responses after authority revocation", async () => {
    const { controller, client } = setup()
    await run(controller.select(source.job.jobId), client)
    await run(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const delayed: Client = {
          ...client,
          operate: (command) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return committed(command)
            })
        }
        const fiber = yield* controller
          .operate("redrive", "redrive-a", true)
          .pipe(Effect.provideService(JobsClient, delayed), Effect.forkChild)
        yield* Deferred.await(entered)
        controller.revokeAuthority("sandbox-expired")
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(fiber)
      }),
      client
    )
    expect(controller.snapshot().pending).toBeUndefined()
    expect(controller.snapshot().detail).toBeUndefined()
    expect(controller.snapshot().error).toBe("sandbox-expired")
    expect(controller.snapshot().notice).not.toContain("Redrive acknowledged")
    controller.dispose()
  })
})
