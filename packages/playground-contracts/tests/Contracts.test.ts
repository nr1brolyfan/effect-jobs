import { describe, expect, it } from "vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { JobDetail, JobPage, ListJobs } from "../src/Jobs.js"
import { ResetResult, ScenarioCommand, ScenarioResult } from "../src/Scenarios.js"
import { Changes, JobsRead, Scenarios, toPublicError } from "../src/Services.js"
import * as Fixtures from "../src/Fixtures.js"
import * as MockLayer from "../src/MockLayer.js"
import { ScenarioDefinitions, ScenarioDefinitionsLayer } from "../src/Definitions.js"
import { SandboxView } from "../src/Sandbox.js"

const access = { sandbox: Fixtures.sandbox }
const run = <A, E>(effect: Effect.Effect<A, E, JobsRead | Changes | Scenarios>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(MockLayer.layer), Effect.provide(TestClock.layer()))
  )
const request = Schema.decodeUnknownSync(ListJobs)({
  sandbox: Fixtures.sandbox.ref,
  filters: {},
  limit: 50
})

describe("frozen playground boundaries", () => {
  it("represents local lifetime counters above old quotas without unsafe numbers", () => {
    const view = {
      ...Fixtures.sandbox,
      capacity: { mode: "local", retainedJobs: 106, admittedCommands: 202 }
    }
    expect(Schema.is(SandboxView)(view)).toBe(true)
    for (const unsafe of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(
        Schema.is(SandboxView)({
          ...view,
          capacity: { ...view.capacity, retainedJobs: unsafe }
        })
      ).toBe(false)
      expect(
        Schema.is(SandboxView)({
          ...view,
          capacity: { ...view.capacity, admittedCommands: unsafe }
        })
      ).toBe(false)
    }
  })
  it("roundtrips privacy-safe fixtures and rejects payload/lease additions", () => {
    expect(
      Schema.decodeUnknownSync(JobDetail)(Schema.encodeSync(JobDetail)(Fixtures.detail))
    ).toEqual(Fixtures.detail)
    expect(Schema.is(JobPage)(Fixtures.page)).toBe(true)
    expect(() =>
      Schema.decodeUnknownSync(JobPage)(
        { ...Fixtures.page, payload: "private" },
        { onExcessProperty: "error" }
      )
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(JobDetail)(
        { ...Fixtures.detail, leaseToken: "private" },
        { onExcessProperty: "error" }
      )
    ).toThrow()
    expect(JSON.stringify(Fixtures.detail)).not.toMatch(
      /ciphertext|fingerprint|leaseToken|password|credential/
    )
  })
  it("bounds requests and preserves unknown commit knowledge", () => {
    for (const limit of [0, 51, 1.5]) {
      expect(Schema.is(ListJobs)({ ...request, limit })).toBe(false)
    }
    const command = {
      sandbox: Fixtures.sandbox.ref,
      requestId: "demo-request",
      scenario: "success",
      count: 10
    }
    expect(Schema.is(ScenarioCommand)(command)).toBe(true)
    expect(Schema.is(ScenarioCommand)({ ...command, count: 11 })).toBe(false)
    expect(
      Schema.is(ScenarioResult)({
        _tag: "OutcomeUnknown",
        sandbox: command.sandbox,
        requestId: command.requestId
      })
    ).toBe(true)
    expect(
      Schema.is(ScenarioResult)({
        _tag: "Committed",
        sandbox: command.sandbox,
        requestId: command.requestId
      })
    ).toBe(false)
  })
  it("accepts only an exact generation advance for a committed reset", () => {
    const previous = Fixtures.sandbox.ref
    const committed = {
      _tag: "Committed",
      previous,
      current: { ...previous, generation: 2 },
      requestId: "demo-reset"
    }
    expect(Schema.is(ResetResult)(committed)).toBe(true)
    expect(Schema.is(ResetResult)({ ...committed, current: previous })).toBe(false)
    expect(
      Schema.is(ResetResult)({ ...committed, current: { ...previous, generation: 3 } })
    ).toBe(false)
    expect(
      Schema.is(ResetResult)({
        ...committed,
        current: { sandboxId: "foreign", generation: 2 }
      })
    ).toBe(false)
  })
  it("uses current library definitions without inventing user/job identity", () => {
    const { ScenarioJob, ScenarioProducer } = Effect.runSync(
      Effect.gen(function* () {
        const first = yield* ScenarioDefinitions
        const second = yield* ScenarioDefinitions
        expect(second).toBe(first)
        expect(first.ScenarioProducer.slots.execute).toBe(first.ScenarioJob)
        return first
      }).pipe(Effect.provide(ScenarioDefinitionsLayer))
    )
    expect(ScenarioJob.catalog).toEqual({
      queue: "playground",
      name: "playground.scenario",
      version: 1
    })
    expect(
      Effect.runSync(
        ScenarioProducer.identity({ operationId: "demo-request", slot: "execute" })
      ).operation
    ).toBe("playground.scenario")
  })
  it("shares one definitions graph across dependent Layers and isolates fresh executions", () => {
    type Definitions = Context.Service.Shape<typeof ScenarioDefinitions>
    class JobView extends Context.Service<JobView, Definitions["ScenarioJob"]>()(
      "test/ScenarioJobView"
    ) {}
    class ProducerView extends Context.Service<
      ProducerView,
      Definitions["ScenarioProducer"]
    >()("test/ScenarioProducerView") {}
    const JobViewLayer = Layer.effect(
      JobView,
      Effect.map(ScenarioDefinitions, (definitions) => definitions.ScenarioJob)
    ).pipe(Layer.provide(ScenarioDefinitionsLayer))
    const ProducerViewLayer = Layer.effect(
      ProducerView,
      Effect.map(ScenarioDefinitions, (definitions) => definitions.ScenarioProducer)
    ).pipe(Layer.provide(ScenarioDefinitionsLayer))
    const graph = Effect.gen(function* () {
      const job = yield* JobView
      const producer = yield* ProducerView
      expect(producer.slots.execute).toBe(job)
      return { job, producer }
    }).pipe(Effect.provide(Layer.merge(JobViewLayer, ProducerViewLayer)))
    const first = Effect.runSync(graph)
    const second = Effect.runSync(graph)
    expect(second.job).not.toBe(first.job)
    expect(second.producer).not.toBe(first.producer)
  })
  it("supplies composable filtered reads and reconciliation-only notifications", async () => {
    expect(
      await run(Effect.flatMap(JobsRead, (read) => read.list(access, request)))
    ).toEqual(Fixtures.page)
    const filtered = await run(
      Effect.flatMap(JobsRead, (read) =>
        read.list(access, { ...request, filters: { state: "Dead" } })
      )
    )
    expect(filtered.items).toEqual([])
    const changes = await run(
      Effect.flatMap(Changes, (read) => read.read(access, { sandbox: request.sandbox }))
    )
    expect(changes).toEqual({
      sandbox: request.sandbox,
      mode: "poll-only",
      reconcile: true,
      hints: []
    })
  })
  it("rejects foreign sandboxes, stale generations and expiry at equality", async () => {
    const foreign = Schema.decodeUnknownSync(ListJobs)({
      ...request,
      sandbox: { ...request.sandbox, sandboxId: "foreign" }
    })
    for (const [query, context, code] of [
      [foreign, access, "not-found"],
      [
        { ...request, sandbox: { ...request.sandbox, generation: 2 } },
        access,
        "stale-generation"
      ],
      [request, { sandbox: { ...Fixtures.sandbox, expiresAt: 1 } }, "sandbox-expired"]
    ] as const) {
      const result = await run(
        Effect.gen(function* () {
          yield* TestClock.setTime(1)
          return yield* Effect.flatMap(JobsRead, (read) => read.list(context, query))
        }).pipe(
          Effect.catchTag("PlaygroundError", (error) =>
            Effect.succeed(toPublicError(error))
          )
        )
      )
      expect(result).toEqual({ code })
    }
  })
  it("does not simulate successful unsupported mutations", async () => {
    const command = Schema.decodeUnknownSync(ScenarioCommand)({
      sandbox: request.sandbox,
      requestId: "demo-request",
      scenario: "success",
      count: 1
    })
    const result = await run(
      Effect.flatMap(Scenarios, (service) => service.run(access, command)).pipe(
        Effect.catchTag("PlaygroundError", (error) =>
          Effect.succeed(toPublicError(error))
        )
      )
    )
    expect(result).toEqual({ code: "capability-unavailable" })
  })
})
