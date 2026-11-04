import { Deferred, Effect, Fiber, Latch, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  EnqueueResult,
  JobIntegrityConflict,
  type PreparedJob
} from "../../src/JobContract.js"
import { JobId } from "../../src/JobId.js"
import * as JobPolicy from "../../src/JobPolicy.js"
import { JobsTransactionClosed, type JobsTransaction } from "../../src/JobTransaction.js"
import {
  insertPrepared,
  insertPreparing,
  withJoinedTransaction
} from "../../src/internal/JobTransaction.js"

const prepared: PreparedJob = {
  catalog: { queue: "billing", kind: "email", version: 1 },
  producer: { operation: "billing.issue", operationId: "request-1", slot: "email" },
  policy: JobPolicy.defaultPolicy,
  encoded: {
    formatVersion: 1,
    payloadBytes: new Uint8Array(),
    semanticProjectionBytes: new Uint8Array()
  }
}
const jobId = Schema.decodeSync(JobId)("assigned-by-backend")

describe("internal callback-scoped capability", () => {
  it("rechecks lifetime after asynchronous preparation without inserting after callback exit", async () => {
    let writes = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const proceed = yield* Deferred.make<void>()
        const fiber = yield* withJoinedTransaction(
          () =>
            Effect.sync(() => {
              writes++
              return EnqueueResult.Inserted({ jobId })
            }),
          (tx) =>
            Effect.gen(function* () {
              const child = yield* insertPreparing(
                tx,
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(proceed)),
                  Effect.as(prepared)
                )
              ).pipe(Effect.forkChild)
              yield* Deferred.await(entered)
              return child
            })
        )
        yield* Deferred.succeed(proceed, undefined)
        const result = yield* Fiber.join(fiber).pipe(Effect.result)
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "JobsTransactionClosed" }
        })
        expect(writes).toBe(0)
      })
    )
  })
  it("rejects an escaped operation before any preparation services run", async () => {
    let escaped: JobsTransaction | undefined
    let preparations = 0
    let writes = 0
    await Effect.runPromise(
      withJoinedTransaction(
        () =>
          Effect.sync(() => {
            writes++
            return EnqueueResult.Inserted({ jobId })
          }),
        (tx) =>
          Effect.sync(() => {
            escaped = tx
          })
      )
    )
    const result = await Effect.runPromise(
      insertPreparing(
        escaped!,
        Effect.sync(() => {
          preparations++
          return prepared
        })
      ).pipe(Effect.result)
    )
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "JobsTransactionClosed" }
    })
    expect(preparations).toBe(0)
    expect(writes).toBe(0)
  })
  it("forwards to exactly the supplied backend and remains provisional", async () => {
    const received: Array<PreparedJob> = []
    const result = await Effect.runPromise(
      withJoinedTransaction(
        (value) =>
          Effect.sync(() => {
            received.push(value)
            return EnqueueResult.Inserted({ jobId })
          }),
        (tx) => insertPrepared(tx, prepared)
      )
    )
    expect(received).toEqual([prepared])
    expect(result).toEqual({ _tag: "Inserted", jobId })
  })
  it("preserves backend and integrity failures rather than committing or replaying", async () => {
    for (const error of ["backend-failure", new JobIntegrityConflict()]) {
      let calls = 0
      const result = await Effect.runPromise(
        withJoinedTransaction(
          () =>
            Effect.suspend(() => {
              calls++
              return Effect.fail(error)
            }),
          (tx) => insertPrepared(tx, prepared)
        ).pipe(Effect.result)
      )
      expect(result).toMatchObject({ _tag: "Failure", failure: error })
      expect(calls).toBe(1)
    }
  })
  it.each(["success", "failure", "defect", "throw", "interruption"] as const)(
    "closes escaped and deferred operations after %s",
    async (exit) => {
      let escaped: JobsTransaction | undefined
      let deferred: ReturnType<typeof insertPrepared<never, never>> | undefined
      let calls = 0
      const program = withJoinedTransaction(
        () =>
          Effect.sync(() => {
            calls++
            return EnqueueResult.Inserted({ jobId })
          }),
        (tx) => {
          escaped = tx
          deferred = insertPrepared(tx, prepared)
          switch (exit) {
            case "success":
              return Effect.void
            case "failure":
              return Effect.fail("failure")
            case "defect":
              return Effect.die("defect")
            case "throw":
              throw new Error("callback throw")
            case "interruption":
              return Effect.interrupt
          }
        }
      )
      await Effect.runPromiseExit(program)
      expect(escaped).toBeDefined()
      expect(Object.isFrozen(escaped)).toBe(true)
      for (const operation of [deferred!, insertPrepared(escaped!, prepared)]) {
        const result = await Effect.runPromise(operation.pipe(Effect.result))
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "JobsTransactionClosed", reason: "callback-exited" }
        })
      }
      expect(calls).toBe(0)
      expect(new JobsTransactionClosed({ reason: "callback-exited" }).message).toContain(
        "joinTransaction callback"
      )
    }
  )
  it("closes when the owner fiber is interrupted, without timing sleeps", async () => {
    let escaped: JobsTransaction | undefined
    let calls = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ready = yield* Latch.make()
          const fiber = yield* withJoinedTransaction(
            () =>
              Effect.sync(() => {
                calls++
                return EnqueueResult.Inserted({ jobId })
              }),
            (tx) =>
              Effect.gen(function* () {
                escaped = tx
                yield* ready.open
                return yield* Effect.never
              })
          ).pipe(Effect.forkScoped)
          yield* ready.await
          yield* Fiber.interrupt(fiber)
        })
      )
    )
    expect(
      await Effect.runPromise(insertPrepared(escaped!, prepared).pipe(Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "JobsTransactionClosed" } })
    expect(calls).toBe(0)
  })
  it("allocates independent lifetimes on every execution of a join Effect", async () => {
    const handles: Array<JobsTransaction> = []
    const program = withJoinedTransaction(
      () => Effect.succeed(EnqueueResult.AlreadyPresent({ jobId })),
      (tx) =>
        Effect.gen(function* () {
          handles.push(tx)
          return yield* insertPrepared(tx, prepared)
        })
    )
    await Effect.runPromise(program)
    await Effect.runPromise(program)
    expect(handles).toHaveLength(2)
    expect(handles[0]).not.toBe(handles[1])
    for (const handle of handles) {
      expect(
        await Effect.runPromise(insertPrepared(handle, prepared).pipe(Effect.result))
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "JobsTransactionClosed" } })
    }
  })
})
