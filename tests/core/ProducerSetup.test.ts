import { Effect, Exit, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import * as Policy from "../../src/JobPolicy.js"
import { JobDeclarationError } from "../../src/JobIdentity.js"
import { EnqueueResult } from "../../src/JobContract.js"
import { JobId } from "../../src/JobId.js"
import { withJoinedTransaction } from "../../src/internal/JobTransaction.js"

const job = Effect.runSync(Job.make({ name: "setup.run", payload: Schema.String }))

it("lazily snapshots Effect producer binding configuration independently on reexecution", () => {
  let queueReads = 0
  let queue = Queue.make<string>("before")
  const options = {
    get queue() {
      queueReads++
      return queue
    }
  }
  const pending = Producer.make("setup.run").pipe(
    Producer.withSlot("execute", job, options)
  )
  expect(Effect.isEffect(pending)).toBe(true)
  expect(queueReads).toBe(0)
  queue = Queue.make("first")
  const first = Effect.runSync(pending)
  queue = Queue.make("second")
  const second = Effect.runSync(pending)
  expect(first.slots.execute.queue.name).toBe("first")
  expect(second.slots.execute.queue.name).toBe("second")
  expect(second).not.toBe(first)
  expect(second.slots).not.toBe(first.slots)
  expect(Object.isFrozen(first.slots.execute)).toBe(true)
  expect(Object.isFrozen(options)).toBe(false)
})

it.each(["", "Bad", "a!", "a".repeat(129)])(
  "keeps invalid operation %j in Fail",
  (operation) => {
    const pending = Producer.make(operation)
    const exit = Effect.runSyncExit(pending)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
    }
    expect(Effect.runSync(Effect.flip(pending))).toBeInstanceOf(JobDeclarationError)
  }
)

it("revalidates policy on each execution while preserving previously returned declarations", () => {
  const policy = { ...Policy.defaultPolicy }
  const pending = Producer.make("setup.run").pipe(
    Producer.withSlot("execute", job, { queue: Queue.make("setup"), policy })
  )
  const first = Effect.runSync(pending)
  policy.maxFinalizedAttempts = 0
  expect(Effect.runSync(Effect.flip(pending))).toMatchObject({
    _tag: "InvalidProducerBinding",
    field: "policy"
  })
  expect(first.slots.execute.policy.maxFinalizedAttempts).toBe(3)
})

it("preserves caller getter defects in binding configuration", () => {
  const defect = new Error("synthetic caller getter")
  const pending = Producer.make("setup.run").pipe(
    Producer.withSlot("execute", job, {
      get queue(): ReturnType<typeof Queue.make> {
        throw defect
      }
    })
  )
  const exit = Effect.runSyncExit(pending)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toEqual([expect.objectContaining({ _tag: "Die", defect })])
  }
})

it("uses the validated fixed route snapshot when caller getters change on subsequent reads", () => {
  let reads = 0
  const options = {
    get queue() {
      reads++
      return reads === 1
        ? Queue.make("validated")
        : ({ name: "INVALID/private" } as never)
    }
  }
  const pending = Producer.make("setup.snapshot").pipe(
    Producer.withSlot("execute", job, options)
  )
  expect(reads).toBe(0)
  const producer = Effect.runSync(pending)
  expect(reads).toBe(1)
  expect(producer.slots.execute.queue.name).toBe("validated")
})

it("reads each queue member name once before validating its owned snapshot", () => {
  let reads = 0
  const queue = {
    ...Queue.make<string>("setup.valid"),
    get name() {
      reads++
      return reads === 1 ? "setup.valid" : "INVALID/member"
    }
  }
  const producer = Effect.runSync(
    Producer.make("setup.member").pipe(Producer.withSlot("execute", job, { queue }))
  )
  expect(reads).toBe(1)
  expect(producer.slots.execute.queue.name).toBe("setup.valid")
  expect(Object.isFrozen(queue)).toBe(false)
})

it("validates the same policy field snapshot exposed by setup and preparation", () => {
  for (const boundary of ["binding", "override"] as const) {
    let reads = 0
    const policy = {
      ...Policy.defaultPolicy,
      get leaseDurationMillis() {
        reads++
        return reads === 1 ? 90_000 : 0
      }
    }
    const producer = Effect.runSync(
      Producer.make("setup.policy").pipe(
        Producer.withSlot("execute", job, {
          queue: Queue.make("setup"),
          ...(boundary === "binding" ? { policy } : {})
        })
      )
    )
    let preparedLease = 0
    Effect.runSync(
      withJoinedTransaction(
        (prepared) =>
          Effect.sync(() => {
            preparedLease = prepared.policy.leaseDurationMillis
            return EnqueueResult.Inserted({
              jobId: Schema.decodeSync(JobId)("setup-policy")
            })
          }),
        (tx) =>
          producer.enqueueInTransaction(tx, {
            slot: "execute",
            operationId: "snapshot",
            payload: "payload",
            ...(boundary === "override" ? { policy } : {})
          })
      )
    )
    expect(reads).toBe(1)
    expect(preparedLease).toBe(90_000)
  }
})
