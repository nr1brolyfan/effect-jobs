import { describe, expect, it } from "vitest"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { JobsClient, type Client } from "../../src/features/jobs/Adapter.js"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import * as FixtureClient from "../../src/features/jobs/FixtureClient.js"

const capable = {
  ...Fixtures.sandbox,
  capabilities: {
    ...Fixtures.sandbox.capabilities,
    runScenario: true,
    resetSandbox: true
  }
}
const execute = <A, E>(
  operation: Effect.Effect<A, E, JobsClient>,
  client: Client = FixtureClient.client
) => Effect.runPromise(operation.pipe(Effect.provide(Layer.succeed(JobsClient, client))))

describe("jobs atom authority", () => {
  it("reads authoritative filters from the registry and keeps mounted registries independent", async () => {
    const first = Atoms.make(Fixtures.sandbox)
    const second = Atoms.make(Fixtures.sandbox)
    first.registry.set(first.atoms.filters, { state: "Dead" })
    await execute(first.refresh)
    expect(first.snapshot().page?.items.every((job) => job.state === "Dead")).toBe(true)
    expect(first.snapshot().page?.stats).toEqual(FixtureClient.page.stats)
    expect(second.registry.get(second.atoms.filters)).toEqual({})
    first.dispose()
    second.dispose()
  })

  it("accepts identity rotation only for the explicitly public demo", async () => {
    const next = Schema.decodeUnknownSync(SandboxView)({
      ...Fixtures.sandbox,
      ref: { sandboxId: "public-demo-replacement", generation: 1 }
    })
    const client: Client = {
      ...FixtureClient.client,
      describe: () => Effect.succeed(next),
      list: () => Effect.succeed({ ...FixtureClient.page, sandbox: next.ref })
    }
    const privateView = Atoms.make(Fixtures.sandbox)
    await execute(privateView.refresh, client)
    expect(privateView.snapshot().error).toBe("not-found")
    const publicView = Atoms.make(Fixtures.sandbox, true)
    await execute(publicView.refresh, client)
    expect(publicView.snapshot().sandbox.ref).toEqual(next.ref)
    expect(publicView.snapshot().page?.sandbox).toEqual(next.ref)
    expect(publicView.snapshot().connection).toBe("connected")
  })
  it("publishes an in-flight detail while repeated same-selection reads reconcile", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    const jobId = FixtureClient.page.items[0]!.jobId
    let details = 0
    await execute(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const client: Client = {
          ...FixtureClient.client,
          detail: (request) =>
            Effect.gen(function* () {
              ++details
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return yield* FixtureClient.client.detail(request)
            })
        }
        yield* Effect.gen(function* () {
          const first = yield* Effect.forkChild(controller.select(jobId))
          yield* Deferred.await(entered)
          yield* controller.refresh
          yield* controller.select(jobId)
          yield* controller.refresh
          expect(details).toBe(1)
          expect(controller.snapshot().detail).toBeUndefined()
          expect(controller.reading()).toBe(false)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(first)
          expect(controller.snapshot().detail?.job.jobId).toBe(jobId)
          yield* controller.refresh
          expect(details).toBe(2)
        }).pipe(Effect.provideService(JobsClient, client))
      })
    )
  })

  it("releases actual read activity when an interrupted read ends", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const client: Client = {
          ...FixtureClient.client,
          describe: () =>
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
        }
        const read = yield* Effect.forkChild(
          controller.refresh.pipe(Effect.provideService(JobsClient, client))
        )
        yield* Deferred.await(entered)
        expect(controller.reading()).toBe(true)
        yield* Fiber.interrupt(read)
        expect(controller.reading()).toBe(false)
        yield* controller.refresh
        expect(controller.snapshot().connection).toBe("connected")
      })
    )
  })

  it.each(["generation", "expiry", "dispose"] as const)(
    "rejects an in-flight detail after %s revokes its lifetime",
    async (revocation) => {
      const controller = Atoms.make(Fixtures.sandbox)
      const jobId = FixtureClient.page.items[0]!.jobId
      await execute(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const old = yield* Effect.forkChild(
            controller.select(jobId).pipe(
              Effect.provideService(JobsClient, {
                ...FixtureClient.client,
                detail: (request) =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(FixtureClient.client.detail(request))
                  )
              })
            )
          )
          yield* Deferred.await(entered)
          if (revocation === "dispose") {
            controller.dispose()
          } else if (revocation === "expiry") {
            yield* controller.refresh.pipe(
              Effect.provideService(JobsClient, {
                ...FixtureClient.client,
                describe: () =>
                  Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
              })
            )
          } else {
            const ref = { ...Fixtures.sandbox.ref, generation: 2 }
            yield* controller.refresh.pipe(
              Effect.provideService(JobsClient, {
                ...FixtureClient.client,
                describe: () => Effect.succeed({ ...Fixtures.sandbox, ref }),
                list: () =>
                  Effect.succeed({
                    sandbox: ref,
                    items: [],
                    nextCursor: null,
                    stats: Fixtures.page.stats
                  })
              })
            )
          }
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(old)
          if (revocation === "dispose") {
            expect(() => controller.snapshot()).toThrow("registry is disposed")
          } else {
            expect(controller.snapshot().detail).toBeUndefined()
          }
        })
      )
    }
  )

  it.each(["command", "receipt"] as const)(
    "acknowledges a historical reset %s without revoking newer generation data",
    async (via) => {
      const controller = Atoms.make(capable)
      const current = { ...capable, ref: { ...capable.ref, generation: 3 } }
      const jobId = FixtureClient.page.items[0]!.jobId
      let descriptions = 0
      let resets = 0
      await execute(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const committed = (request: Parameters<Client["reset"]>[0]) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return {
                _tag: "Committed" as const,
                previous: request.sandbox,
                current: { ...request.sandbox, generation: 2 },
                requestId: request.requestId
              }
            })
          const client: Client = {
            ...FixtureClient.client,
            reset: (request) => {
              ++resets
              return via === "command"
                ? committed(request)
                : Effect.succeed({
                    _tag: "OutcomeUnknown",
                    previous: request.sandbox,
                    requestId: request.requestId
                  })
            },
            resetReceipt: committed,
            describe: () =>
              Effect.suspend(() =>
                ++descriptions === 1
                  ? Effect.succeed(current)
                  : Effect.fail(new PlaygroundError({ code: "unavailable" }))
              ),
            list: () => Effect.succeed({ ...FixtureClient.page, sandbox: current.ref }),
            detail: (request) =>
              Effect.succeed({
                ...Fixtures.detail,
                sandbox: current.ref,
                job: { ...Fixtures.detail.job, jobId: request.jobId }
              })
          }
          yield* Effect.gen(function* () {
            if (via === "receipt") {
              yield* controller.command("reset", "historical-reset", "success", 1)
            }
            const old = yield* Effect.forkChild(
              via === "command"
                ? controller.command("reset", "historical-reset", "success", 1)
                : controller.receipt
            )
            yield* Deferred.await(entered)
            yield* controller.filter({ state: "Dead" })
            yield* controller.select(jobId)
            const before = controller.snapshot()
            expect(before.sandbox.ref.generation).toBe(3)
            expect(before.detail?.job.jobId).toBe(jobId)
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(old)
            const after = controller.snapshot()
            expect(after.sandbox.ref.generation).toBe(3)
            expect(after.page).toBe(before.page)
            expect(after.detail).toBe(before.detail)
            expect(after.selected).toBe(before.selected)
            expect(after.filters).toEqual(before.filters)
            expect(after.pending).toBeUndefined()
            expect(after.busy).toBe(false)
            expect(after.error).toBe("unavailable")
            expect(resets).toBe(1)
          }).pipe(Effect.provideService(JobsClient, client))
        })
      )
    }
  )

  it("combines exact filters and retains selection, cursor and filters during reconciliation", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.refresh)
    await execute(controller.next)
    const before = controller.snapshot()
    const job = before.page?.items[0]
    expect(job).toBeDefined()
    if (job === undefined) {
      return
    }
    await execute(controller.select(job.jobId))
    await execute(controller.refresh)
    expect(controller.snapshot().cursor).toBe(before.cursor)
    expect(controller.snapshot().pageNumber).toBe(2)
    expect(controller.snapshot().selected).toBe(job.jobId)
    await execute(controller.filter({ state: "Dead", kind: "playground.scenario" }))
    expect(controller.snapshot().cursor).toBeUndefined()
    expect(controller.snapshot().page?.items).toHaveLength(2)
    expect(controller.snapshot().selected).toBe(job.jobId)
    await execute(controller.filter({ state: "Dead", kind: "absent" }))
    expect(controller.snapshot().page?.items).toHaveLength(0)
  })

  it("keeps the current cursor on invalidation errors until an explicit first-page action", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.refresh)
    await execute(controller.next)
    const cursor = controller.snapshot().cursor
    await execute(controller.refresh, {
      ...FixtureClient.client,
      list: () => Effect.fail(new PlaygroundError({ code: "invalid-request" }))
    })
    expect(controller.snapshot()).toMatchObject({
      cursor,
      connection: "stale",
      error: "invalid-request",
      pageNumber: 2
    })
    await execute(controller.first)
    expect(controller.snapshot()).toMatchObject({
      connection: "connected",
      pageNumber: 1
    })
    expect(controller.snapshot().cursor).toBeUndefined()
  })

  it("drops an older list response arriving after a filter change", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(
      Effect.gen(function* () {
        const waiting = yield* Deferred.make<void>()
        const entered = yield* Deferred.make<void>()
        let calls = 0
        const client: Client = {
          ...FixtureClient.client,
          list: (request) =>
            Effect.gen(function* () {
              if (++calls === 1) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(waiting)
              }
              return yield* FixtureClient.client.list(request)
            })
        }
        yield* Effect.gen(function* () {
          const old = yield* Effect.forkChild(controller.refresh)
          yield* Deferred.await(entered)
          yield* controller.filter({ state: "Isolated" })
          yield* Deferred.succeed(waiting, undefined)
          yield* Fiber.join(old)
        }).pipe(Effect.provide(Layer.succeed(JobsClient, client)))
      })
    )
    expect(
      controller.snapshot().page?.items.every((job) => job.state === "Isolated")
    ).toBe(true)
  })

  it("drops an older detail response after selecting another job", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    const a = FixtureClient.page.items[0]!
    const b = FixtureClient.page.items[1]!
    await execute(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const client: Client = {
          ...FixtureClient.client,
          detail: (request) =>
            Effect.gen(function* () {
              if (request.jobId === a.jobId) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return yield* FixtureClient.client.detail(request)
            })
        }
        yield* Effect.gen(function* () {
          const old = yield* Effect.forkChild(controller.select(a.jobId))
          yield* Deferred.await(entered)
          yield* controller.select(b.jobId)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(old)
        }).pipe(Effect.provide(Layer.succeed(JobsClient, client)))
      })
    )
    expect(controller.snapshot().detail?.job.jobId).toBe(b.jobId)
  })

  it("never sends disabled commands or pretends mock success", async () => {
    let sent = 0
    const client = {
      ...FixtureClient.client,
      run: () => {
        ++sent
        return Effect.fail(new PlaygroundError({ code: "capability-unavailable" }))
      }
    }
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.command("scenario", "request", "success", 1), client)
    expect(sent).toBe(0)
    expect(controller.snapshot().notice).toContain("No command was sent")
  })

  it("retains an unknown request, forbids replay and reconciles only its receipt", async () => {
    let sent = 0
    let receiptId = ""
    const client: Client = {
      ...FixtureClient.client,
      describe: () => Effect.succeed(capable),
      run: (command) => {
        ++sent
        return Effect.succeed({
          _tag: "OutcomeUnknown",
          sandbox: command.sandbox,
          requestId: command.requestId
        })
      },
      scenarioReceipt: (request) => {
        receiptId = request.requestId
        return Effect.fail(new PlaygroundError({ code: "not-found" }))
      }
    }
    const controller = Atoms.make(capable)
    await execute(
      controller.command("scenario", "exact-request", "unknown-outcome", 1),
      client
    )
    await execute(controller.command("scenario", "another", "success", 1), client)
    await execute(controller.receipt, client)
    expect(sent).toBe(1)
    expect(receiptId).toBe("exact-request")
    expect(controller.snapshot().pending?.request.requestId).toBe("exact-request")
    expect(controller.snapshot().notice).toContain("does not authorize replay")
    await execute(controller.receipt, {
      ...client,
      scenarioReceipt: (request) =>
        Effect.succeed({
          _tag: "Committed",
          ...request,
          jobIds: [Fixtures.detail.job.jobId]
        })
    })
    expect(controller.snapshot().pending).toBeUndefined()
    expect(controller.snapshot().notice).toContain("Handler success is not confirmed")
  })

  it("treats a failed command response as uncertain and validates scenario bounds before sending", async () => {
    const controller = Atoms.make(capable)
    await execute(controller.command("scenario", "bad", "success", 11))
    expect(controller.snapshot().pending).toBeUndefined()
    await execute(controller.command("scenario", "sent", "success", 1), {
      ...FixtureClient.client,
      run: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
    })
    expect(controller.snapshot().pending?.request.requestId).toBe("sent")
    expect(controller.snapshot().notice).toContain("Do not replay")
  })

  it("hides old generation data on external reset while retaining filters", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.filter({ state: "Dead" }))
    await execute(controller.select(FixtureClient.page.items[0]!.jobId))
    const ref = { ...Fixtures.sandbox.ref, generation: 2 }
    await execute(controller.refresh, {
      ...FixtureClient.client,
      describe: () => Effect.succeed({ ...Fixtures.sandbox, ref }),
      list: () =>
        Effect.succeed({
          sandbox: ref,
          items: [],
          nextCursor: null,
          stats: Fixtures.page.stats
        })
    })
    expect(controller.snapshot().filters).toEqual({ state: "Dead" })
    expect(controller.snapshot().selected).toBeUndefined()
    expect(controller.snapshot().detail).toBeUndefined()
    expect(controller.snapshot().sandbox.ref.generation).toBe(2)
    expect(controller.snapshot().notice).toContain("revoked")
  })

  it("revokes old data immediately after acknowledged reset even if describe fails", async () => {
    const controller = Atoms.make(capable)
    await execute(controller.refresh, {
      ...FixtureClient.client,
      describe: () => Effect.succeed(capable)
    })
    await execute(controller.select(FixtureClient.page.items[0]!.jobId))
    await execute(controller.command("reset", "reset-request", "success", 1), {
      ...FixtureClient.client,
      reset: (command) =>
        Effect.succeed({
          _tag: "Committed",
          previous: command.sandbox,
          current: { ...command.sandbox, generation: 2 },
          requestId: command.requestId
        }),
      describe: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
    })
    expect(controller.snapshot().page).toBeUndefined()
    expect(controller.snapshot().detail).toBeUndefined()
    expect(controller.snapshot().selected).toBeUndefined()
    expect(controller.snapshot().sandbox.ref.generation).toBe(2)
  })

  it("rejects foreign-sandbox reads and excess metadata without exposing raw input", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.refresh, {
      ...FixtureClient.client,
      list: () =>
        Effect.succeed({
          ...Fixtures.page,
          sandbox: { ...Fixtures.sandbox.ref, generation: 3 }
        })
    })
    expect(controller.snapshot().error).toBe("stale-generation")
    await execute(controller.refresh, {
      ...FixtureClient.client,
      list: () => Effect.succeed({ ...Fixtures.page, payload: "secret-marker" })
    })
    expect(controller.snapshot().error).toBe("unavailable")
    expect(JSON.stringify(controller.snapshot())).not.toContain("secret-marker")
  })

  it("disposal prevents late operations from changing the mounted state", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    controller.dispose()
    await execute(controller.refresh)
    expect(controller.reading()).toBe(false)
  })

  it("does not release another operation's busy slot on duplicate commands or receipt clicks", async () => {
    const controller = Atoms.make(capable)
    let sent = 0
    await execute(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const client: Client = {
          ...FixtureClient.client,
          run: (command) =>
            Effect.gen(function* () {
              ++sent
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return {
                _tag: "OutcomeUnknown" as const,
                sandbox: command.sandbox,
                requestId: command.requestId
              }
            })
        }
        yield* Effect.gen(function* () {
          const first = yield* Effect.forkChild(
            controller.command("scenario", "one", "success", 1)
          )
          yield* Deferred.await(entered)
          yield* controller.command("scenario", "two", "success", 1)
          yield* controller.receipt
          expect(controller.snapshot().busy).toBe(true)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(first)
        }).pipe(Effect.provide(Layer.succeed(JobsClient, client)))
      })
    )
    expect(sent).toBe(1)
    expect(controller.snapshot().busy).toBe(false)
    expect(controller.snapshot().pending?.request.requestId).toBe("one")
  })

  it("hides retained metadata when describe revokes expired sandbox authority", async () => {
    const controller = Atoms.make(Fixtures.sandbox)
    await execute(controller.refresh)
    await execute(controller.select(FixtureClient.page.items[0]!.jobId))
    await execute(controller.refresh, {
      ...FixtureClient.client,
      describe: () => Effect.fail(new PlaygroundError({ code: "sandbox-expired" }))
    })
    expect(controller.snapshot().page).toBeUndefined()
    expect(controller.snapshot().detail).toBeUndefined()
    expect(controller.snapshot().error).toBe("sandbox-expired")
  })
})
