import { Context, Effect, Schema, SchemaGetter } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as Group from "../../../src/JobGroup.js"
import * as Producer from "../../../src/JobProducer.js"
import * as Queue from "../../../src/JobQueue.js"
import { JobEnqueue } from "../../../src/JobEnqueue.js"
import { EnqueueResult } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"
import type { PreparedJob } from "../../../src/JobContract.js"

describe("pure Job contracts", () => {
  it("snapshots only kind/version/Schema, preserves native Schema identity, and starts no work", () => {
    const options = { kind: "invoice.generate", payload: Schema.String, version: 2 }
    const job = Job.make(options)
    options.kind = "changed"
    options.version = 3
    expect(job).toEqual({ kind: "invoice.generate", version: 2, payload: Schema.String })
    expect(Object.keys(job).sort()).toEqual(["kind", "payload", "version"])
    expect(Object.isFrozen(job)).toBe(true)
    expect(Object.isFrozen(options)).toBe(false)
    expect(Job.make({ kind: "invoice.generate", payload: Schema.String }).version).toBe(1)
  })

  it.each([0, -1, 1.5, 32768, Number.NaN])(
    "rejects invalid version %s at declaration",
    (version) => {
      expect(() =>
        Job.make({ kind: "invoice.generate", version, payload: Schema.String })
      ).toThrow(Job.InvalidJobDefinition)
    }
  )

  it("rejects superseded options even when passed indirectly at runtime", () => {
    const base = { kind: "invoice.generate", payload: Schema.String }
    expect(() =>
      Job.make({ ...base, queue: Queue.make("billing") } as typeof base)
    ).toThrow(Job.InvalidJobDefinition)
    expect(() =>
      Job.make({
        ...base,
        encodePayload: () => Effect.die("must not run")
      } as typeof base)
    ).toThrow(Job.InvalidJobDefinition)
    expect(() => Job.make({ ...base, kind: "INVALID" })).toThrow(Job.InvalidJobDefinition)
    expect(() =>
      Job.make({ ...base, payload: Schema.Record(Schema.String, Schema.String) })
    ).toThrow(Job.InvalidJobDefinition)
  })

  it("uses one contract on distinct routes and encodes/decodes through producer/group Schema services", async () => {
    class Prefix extends Context.Service<Prefix, { readonly value: string }>()(
      "tests/pure-contract/Prefix"
    ) {}
    const payload = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transformEffect((value) =>
          Effect.map(Prefix, (prefix) => prefix.value + value)
        ),
        encode: SchemaGetter.transformEffect((value) =>
          Effect.map(Prefix, (prefix) => value.slice(prefix.value.length))
        )
      })
    )
    const job = Job.make({ kind: "invoice.generate", payload })
    const a = Queue.make("billing-a")
    const b = Queue.make("billing-b")
    const producer = Producer.make({
      operation: "billing.issue",
      slots: { a: { job, queue: a }, b: { job, queue: b } }
    })
    const prepared: PreparedJob[] = []
    const group = Group.make("pure-contract", { generate: job })
    const seen: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* producer.enqueue({
          slot: "a",
          operationId: "one",
          payload: "prefix:invoice"
        })
        yield* producer.enqueue({
          slot: "b",
          operationId: "two",
          payload: "prefix:invoice"
        })
        const handlers = yield* group.handlers
        for (const value of prepared) {
          yield* handlers.generate(value.encoded, {
            jobId: yield* Schema.decodeEffect(JobId)("fixture"),
            catalog: value.catalog,
            producer: value.producer,
            nextFinalizationNumber: 1
          })
        }
      }).pipe(
        Effect.provideService(
          JobEnqueue,
          JobEnqueue.of({
            enqueue: (prepare) =>
              Effect.flatMap(prepare, (value) =>
                Effect.sync(() => {
                  prepared.push(value)
                  return EnqueueResult.Inserted({
                    jobId: Schema.decodeSync(JobId)("fixture")
                  })
                })
              ),
            enqueueStandalone: () => Effect.die("unexpected standalone")
          })
        ),
        Effect.provide(
          group.toLayer({
            generate: (input) =>
              Effect.sync(() => {
                seen.push(input.payload)
              })
          })
        ),
        Effect.provideService(Prefix, { value: "prefix:" })
      )
    )
    expect(prepared.map((value) => value.catalog.queue)).toEqual([
      "billing-a",
      "billing-b"
    ])
    expect(seen).toEqual(["prefix:invoice", "prefix:invoice"])
  })
})
