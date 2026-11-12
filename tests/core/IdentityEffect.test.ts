import { Effect, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import { validateOperationId } from "../../src/JobIdentity.js"
import { JobEnqueue } from "../../src/JobEnqueue.js"
import {
  enqueueReport,
  ReportDefinitionsLayer
} from "../../apps/website/examples/docs/ReportWorkflow.js"

const job = Effect.runSync(
  Job.make({
    name: "identity.test",
    payload: Schema.String
  })
)
const producer = Effect.runSync(
  Producer.make("identity.test").pipe(
    Producer.withSlot("run", job, { queue: Queue.make("identity") })
  )
)

describe("lazy typed identity", () => {
  it("returns a typed validation failure without throwing or dying", () => {
    const pending = validateOperationId("private\u0000value\ud800")
    expect(Effect.isEffect(pending)).toBe(true)
    const result = Effect.runSync(Effect.result(pending))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "InvalidOperationId",
        rule: "unicode-scalars"
      })
      expect(JSON.stringify(result.failure)).not.toContain("private")
    }
  })

  it("reads input once at execution and takes a fresh snapshot on reexecution", () => {
    let reads = 0
    let operationId = "before"
    const seen: Array<{
      readonly operation: string
      readonly operationId: string
      readonly slot: string
    }> = []
    const input = {
      get operationId() {
        reads++
        return operationId
      },
      slot: "run" as const,
      payload: "fixture"
    }
    const pending = producer.enqueue(input).pipe(
      Effect.provideService(
        JobEnqueue,
        JobEnqueue.of({
          enqueue: (prepared) =>
            Effect.map(prepared, (value) => {
              seen.push(value.producer)
              return { _tag: "Inserted" as const, jobId: "fixture" as never }
            }),
          enqueueStandalone: () => Effect.die("unexpected standalone")
        })
      )
    )
    expect(reads).toBe(0)
    operationId = " é "
    Effect.runSync(pending)
    const first = seen[0]!
    expect(first).toEqual({ operation: "identity.test", operationId: " é ", slot: "run" })
    expect(reads).toBe(1)
    operationId = "é"
    Effect.runSync(pending)
    const second = seen[1]!
    expect(second.operationId).toBe("é")
    expect(first.operationId).toBe(" é ")
    expect(second).not.toBe(first)
    expect(reads).toBe(2)
    expect(Object.isFrozen(first)).toBe(true)
    operationId = ""
    expect(Effect.runSync(Effect.flip(pending))).toMatchObject({
      _tag: "InvalidOperationId",
      rule: "utf8-length",
      byteLength: 0
    })
  })

  it("rejects removed public identity helpers and undeclared slots before preparation", () => {
    expect(producer).not.toHaveProperty("identity")
    const service = JobEnqueue.of({
      enqueue: (prepared) =>
        Effect.as(prepared, { _tag: "Inserted" as const, jobId: "fixture" as never }),
      enqueueStandalone: () => Effect.die("unexpected standalone")
    })
    const rejected = producer.enqueue({
      operationId: "valid",
      slot: "absent",
      payload: "fixture"
    } as never)
    expect(
      Effect.runSync(
        Effect.flip(rejected).pipe(Effect.provideService(JobEnqueue, service))
      )
    ).toMatchObject({ _tag: "InvalidJobInput", field: "producer" })
  })

  it("the actual report caller returns typed InvalidOperationId before persistence for an empty ID", () => {
    const pending = enqueueReport("", { reportId: "r", rows: [] })
    expect(Effect.isEffect(pending)).toBe(true)
    // The authority-owning service evaluates preparation before encoding or SQL.
    expect(
      Effect.runSync(
        Effect.flip(pending).pipe(
          Effect.provideService(
            JobEnqueue,
            JobEnqueue.of({
              enqueue: (prepared) =>
                Effect.flatMap(prepared, () => Effect.die("unexpected persistence call")),
              enqueueStandalone: () => Effect.die("unexpected backend call")
            })
          ),
          Effect.provide(ReportDefinitionsLayer)
        )
      )
    ).toMatchObject({ _tag: "InvalidOperationId", rule: "utf8-length" })
  })
})
