import { Cause, Context, Effect, Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Schedule from "../../../src/JobSchedule.js"
import * as Group from "../../../src/JobGroup.js"
import * as Queue from "../../../src/JobQueue.js"
import { makeSchedule } from "../../../src/postgresql/internal/Schedule.js"
import type {
  ApplicationAdapter,
  TransactionQuery
} from "../../../src/postgresql/PostgreSqlTransaction.js"

const queue = Queue.make("schedule")
const group = Group.make("schedule", {
  run: { name: "supported", version: 2, payload: Schema.String }
})
const catalog = { queue: queue.name, name: "supported", version: 2 }
const request: Schedule.Request = {
  queue: queue.name,
  supportedCatalog: [catalog],
  limit: 2
}
const row = (
  kind: string | null,
  version: number | null,
  availableAt: string | null,
  recoveryAt: string | null = null
) => ({
  observed_at: "1000",
  kind,
  version,
  available_at: availableAt,
  recovery_at: recoveryAt
})
const fixture = (
  rows: ReadonlyArray<Record<string, unknown>>,
  beforeQuery: () => void = () => {}
) => {
  const queries: Array<{ text: string; values: ReadonlyArray<unknown> | undefined }> = []
  let transactions = 0
  const query: TransactionQuery = {
    query: (text, values) =>
      Effect.sync(() => {
        beforeQuery()
        queries.push({ text, values })
        return rows
      })
  }
  const adapter: ApplicationAdapter = {
    validate: () => Effect.die("must not join"),
    withTransaction: () => Effect.die("must not establish business transaction"),
    ownedTransaction: (body) =>
      Effect.suspend(() => {
        transactions++
        return body(query)
      })
  }
  return {
    reader: makeSchedule(adapter, '"app"."jobs"'),
    queries,
    transactions: () => transactions
  }
}

describe("JobSchedule observations", () => {
  it("constructs without activity and performs one parameterized read-only statement", async () => {
    const test = fixture([row("supported", 2, "999", "1100")])
    const source = await Effect.runPromise(Schedule.make(test.reader))
    expect(test.transactions()).toBe(0)
    expect(test.queries).toHaveLength(0)
    const observation = await Effect.runPromise(source.read(request))
    expect(observation).toEqual({
      observedAt: 1000,
      nextAvailableAt: 999,
      nextRecoveryAt: 1100,
      saturated: false
    })
    expect(Object.isFrozen(observation)).toBe(true)
    expect(test.transactions()).toBe(1)
    expect(test.queries).toHaveLength(1)
    expect(test.queries[0]!.values).toEqual([queue.name, 3])
    expect(test.queries[0]!.text).toContain("clock_timestamp()")
    expect(test.queries[0]!.text).toContain("ORDER BY available_at,id LIMIT $2")
    expect(test.queries[0]!.text).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT|TRUNCATE|FOR|LOCK)\b/u
    )
    expect(test.queries[0]!.text).not.toMatch(
      /payload|projection|operation_id|lease_token/u
    )
  })

  it("marks a head filled by unsupported versions as inconclusive, without scanning past the bound", async () => {
    const rows = [row("supported", 1, "900"), row("supported", 2, "1200")]
    const test = fixture(rows)
    expect(await Effect.runPromise(test.reader.read({ ...request, limit: 1 }))).toEqual({
      observedAt: 1000,
      nextAvailableAt: null,
      nextRecoveryAt: null,
      saturated: true
    })
    expect(await Effect.runPromise(test.reader.read(request))).toEqual({
      observedAt: 1000,
      nextAvailableAt: 1200,
      nextRecoveryAt: null,
      saturated: false
    })
  })

  it("represents an empty pending head while retaining the queue's next recovery", async () => {
    const test = fixture([row(null, null, null, "800")])
    expect(await Effect.runPromise(test.reader.read(request))).toEqual({
      observedAt: 1000,
      nextAvailableAt: null,
      nextRecoveryAt: 800,
      saturated: false
    })
  })

  it("snapshots selection before asynchronous source work", async () => {
    const input = { queue: "schedule", limit: 2, supportedCatalog: [{ ...catalog }] }
    const test = fixture([row("supported", 2, "1100")], () => {
      input.queue = "changed"
      input.limit = 1
      input.supportedCatalog[0]!.name = "changed"
    })
    const observed = await Effect.runPromise(test.reader.read(input))
    expect(test.queries[0]!.values).toEqual([queue.name, 3])
    expect(observed.nextAvailableAt).toBe(1100)
  })

  it.each([
    { ...request, limit: 0 },
    { ...request, limit: 501 },
    { ...request, limit: 1.5 },
    { ...request, queue: "BAD" },
    { ...request, supportedCatalog: [] },
    { ...request, supportedCatalog: [{ ...catalog, queue: "another" }] },
    { ...request, supportedCatalog: Array.from({ length: 501 }, () => catalog) },
    { ...request, extra: true }
  ])("rejects invalid request before acquiring storage %#", async (input) => {
    const test = fixture([])
    const result = await Effect.runPromise(test.reader.read(input).pipe(Effect.result))
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "JobScheduleProtocolError", reason: "invalid-input" }
    })
    expect(test.transactions()).toBe(0)
    expect(test.queries).toHaveLength(0)
  })

  it.each([
    { rows: [] },
    { rows: [row("supported", 2, " 1000")] },
    { rows: [row("supported", 2, "-1")] },
    { rows: [{ ...row("supported", 2, "1000"), observed_at: "NaN" }] },
    { rows: [{ ...row(null, null, null), recovery_at: "8640000000000001" }] },
    { rows: [row("supported", 0, "1000")] }
  ])("fails safely on malformed observation metadata %#", async (testCase) => {
    const test = fixture(testCase.rows)
    const result = await Effect.runPromise(test.reader.read(request).pipe(Effect.result))
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalid-observation" }
    })
  })

  it("observes a group's contracts with default bounds and without installing handlers", async () => {
    class Source extends Context.Service<Source, { readonly value: number }>()(
      "tests/schedule/Source"
    ) {}
    const seen: Schedule.Request[] = []
    const reader: Schedule.Reader<never, Source> = {
      read: (input) =>
        Effect.map(Source, (source) => {
          seen.push(input)
          return {
            observedAt: source.value,
            nextAvailableAt: null,
            nextRecoveryAt: null,
            saturated: false
          }
        })
    }
    const source = await Effect.runPromise(
      Schedule.make(reader).pipe(Effect.provideService(Source, { value: 1234 }))
    )
    const observed = await Effect.runPromise(
      Schedule.observe(group, queue).pipe(
        Effect.provideService(Schedule.JobSchedule, source)
      )
    )
    expect(observed.observedAt).toBe(1234)
    expect(seen).toEqual([{ queue: queue.name, supportedCatalog: [catalog], limit: 100 }])
    for (const options of [{ limit: 0 }, { limit: 501 }, { limit: 2, extra: true }]) {
      expect(
        await Effect.runPromise(
          Schedule.observe(group, queue, options).pipe(
            Effect.provideService(Schedule.JobSchedule, source),
            Effect.result
          )
        )
      ).toMatchObject({ _tag: "Failure", failure: { reason: "invalid-input" } })
    }
    expect(seen).toHaveLength(1)
  })

  it("sanitizes provider failures but preserves protocol errors, defects and interruption", async () => {
    const protocol = new Schedule.JobScheduleProtocolError({
      reason: "invalid-observation"
    })
    const privateError = { detail: "PRIVATE_SCHEDULE_PROVIDER" }
    const defect = { marker: "defect" }
    const operations: ReadonlyArray<
      Effect.Effect<never, typeof privateError | Schedule.JobScheduleProtocolError>
    > = [
      Effect.fail(privateError),
      Effect.fail(protocol),
      Effect.die(defect),
      Effect.interrupt,
      Effect.failCause(Cause.combine(Cause.fail(privateError), Cause.die(defect)))
    ]
    for (const operation of operations) {
      const configured = await Effect.runPromise(Schedule.make({ read: () => operation }))
      const original = await Effect.runPromiseExit(operation)
      const exit = await Effect.runPromiseExit(configured.read(request))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        if (Exit.isFailure(original)) {
          expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(
            original.cause.reasons.map((reason) => reason._tag)
          )
        }
        for (const reason of exit.cause.reasons) {
          if (Cause.isFailReason(reason)) {
            expect(
              reason.error === protocol ||
                reason.error instanceof Schedule.JobScheduleUnavailable
            ).toBe(true)
            expect(JSON.stringify(reason.error)).not.toContain(
              "PRIVATE_SCHEDULE_PROVIDER"
            )
          }
          if (Cause.isDieReason(reason)) {
            expect(reason.defect).toBe(defect)
          }
        }
      }
    }
  })
})
