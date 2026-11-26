import assert from "node:assert/strict"
import { DateTime, Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Producer from "effect-jobs/JobProducer"
import * as Queue from "effect-jobs/JobQueue"
import * as Testing from "effect-jobs/testing"

await Effect.runPromise(
  Effect.gen(function* () {
    const job = yield* Job.make({
      name: "billing.invoice",
      payload: Schema.DateTimeUtcFromString
    })
    const queue = yield* Queue.make("billing")
    const producer = yield* Producer.make("billing.issue").pipe(
      Producer.withSlot("invoice", job, { queue })
    )
    const payload = DateTime.makeUnsafe(1_725_000_000_000)
    const result = yield* producer
      .enqueue({ slot: "invoice", operationId: "order-1", payload })
      .pipe(Testing.withJoinedEnqueue)
    const captures = yield* Testing.enqueuedOf(job)
    assert.equal(captures.length, 1)
    assert.equal(captures[0].jobId, result.jobId)
    assert.equal(
      DateTime.toEpochMillis(captures[0].payload),
      DateTime.toEpochMillis(payload)
    )
  }).pipe(Effect.provide(Testing.layer))
)
