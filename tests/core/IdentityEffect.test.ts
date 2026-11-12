import { Effect, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import { validateOperationId } from "../../src/JobIdentity.js"
import { JobEnqueue } from "../../src/JobEnqueue.js"
import { enqueueReport } from "../../apps/website/examples/docs/ReportWorkflow.js"

const job = Job.make({
  name: "identity.test",
  queue: Queue.make("identity"),
  payload: Schema.String
})
const producer = Producer.make({ operation: "identity.test", slots: { run: job } })

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
    const input = {
      get operationId() {
        reads++
        return operationId
      },
      slot: "run" as const
    }
    const pending = producer.identity(input)
    expect(reads).toBe(0)
    operationId = " é "
    const first = Effect.runSync(pending)
    expect(first).toEqual({ operation: "identity.test", operationId: " é ", slot: "run" })
    expect(reads).toBe(1)
    operationId = "é"
    const second = Effect.runSync(pending)
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

  it("keeps invalid operation ID precedence over an undeclared slot", () => {
    expect(
      Effect.runSync(
        Effect.flip(producer.identity({ operationId: "", slot: "absent" } as never))
      )
    ).toMatchObject({ _tag: "InvalidOperationId" })
    expect(
      Effect.runSync(
        Effect.flip(producer.identity({ operationId: "valid", slot: "absent" } as never))
      )
    ).toMatchObject({ _tag: "JobDeclarationError", field: "slots" })
  })

  it("the actual report caller returns InvalidJobInput in Effect for an empty ID", () => {
    const pending = enqueueReport("", { reportId: "r", rows: [] })
    expect(Effect.isEffect(pending)).toBe(true)
    // Validation rejects before asking for the backend, encoding or starting a transaction.
    expect(
      Effect.runSync(
        Effect.flip(pending).pipe(
          Effect.provideService(
            JobEnqueue,
            JobEnqueue.of({
              enqueue: () => Effect.die("unexpected backend call"),
              enqueueStandalone: () => Effect.die("unexpected backend call")
            })
          )
        )
      )
    ).toMatchObject({ _tag: "InvalidJobInput", field: "producer" })
  })
})
