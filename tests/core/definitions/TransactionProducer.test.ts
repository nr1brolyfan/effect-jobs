/** Port doubles exercise bridge composition and lifetime, not PostgreSQL atomicity. */
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Jobs from "../../../src/PostgreSqlJobs.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Producer from "../../../src/JobProducer.js"
import { JobEnqueue } from "../../../src/JobEnqueue.js"
import type { JobEnqueueService } from "../../../src/JobEnqueue.js"
import {
  PostgreSqlApplication,
  PostgreSqlInvalidHandle
} from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"
import type { PreparedJob } from "../../../src/JobContract.js"

const producer = Producer.make("billing.issue").pipe(
  Producer.withSlot(
    "receipt",
    { kind: "billing.receipt", version: 1, payload: Schema.String },
    {
      queue: Queue.make("billing")
    }
  )
)

const fixture = (native: boolean) => {
  const handle = {}
  const calls: string[] = []
  let active = false
  const query: TransactionQuery = {
    query: (text, values = []) =>
      Effect.suspend((): ReturnType<TransactionQuery["query"]> => {
        calls.push(text)
        if (!active) {
          return Effect.fail(new PostgreSqlInvalidHandle({ reason: "inactive-handle" }))
        }
        if (text.startsWith("SELECT floor")) {
          return Effect.succeed([{ now: 100000 }])
        }
        if (text.includes("'Pending'")) {
          return Effect.succeed([{ id: values[0] }])
        }
        if (text.startsWith("INSERT INTO")) {
          return Effect.succeed([])
        }
        return Effect.die("Unexpected query in production bridge fixture")
      })
  }
  const adapter: ApplicationAdapter = {
    ...(native
      ? {
          ambient: Effect.suspend(() =>
            active
              ? Effect.succeed(query)
              : Effect.fail(new PostgreSqlInvalidHandle({ reason: "inactive-handle" }))
          )
        }
      : {}),
    validate: (input) =>
      Effect.suspend(() =>
        input === handle && active && !native
          ? Effect.succeed(query)
          : Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" }))
      ),
    withTransaction: (body) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          active = true
        }),
        () => Effect.suspend(() => body(handle)),
        () =>
          Effect.sync(() => {
            active = false
          })
      ),
    ownedTransaction: () =>
      Effect.die("Bound standalone must not open an independent transaction")
  }
  return { adapter, calls }
}

describe("invocation-bound ambient production", () => {
  it.each([false, true])(
    "provides ambient production through an adapter with native ambient=%s",
    async (native) => {
      const test = fixture(native)
      await Effect.runPromise(
        Effect.gen(function* () {
          const jobs = yield* Jobs.make({ operationResponseBudgetMillis: 100 })
          const result = yield* jobs.withTransaction(() =>
            producer.enqueue({ slot: "receipt", operationId: "one", payload: "one" })
          )
          expect(result._tag).toBe("Inserted")
          expect(test.calls).toHaveLength(3)
        }).pipe(Effect.provideService(PostgreSqlApplication, test.adapter))
      )
    }
  )

  it("joinTransaction supplies its validated capability without an ambient adapter", async () => {
    const test = fixture(false)
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs.make({ operationResponseBudgetMillis: 100 })
        const result = yield* test.adapter.withTransaction((handle) =>
          jobs.joinTransaction(handle, () =>
            producer.enqueue({ slot: "receipt", operationId: "one", payload: "one" })
          )
        )
        expect(result._tag).toBe("Inserted")
        expect(test.calls).toHaveLength(3)
      }).pipe(Effect.provideService(PostgreSqlApplication, test.adapter))
    )
  })

  it.each([false, true])(
    "rejects escaped callback services before preparation, native ambient=%s",
    async (native) => {
      const test = fixture(native)
      let escaped: JobEnqueueService | undefined
      let preparations = 0
      await Effect.runPromise(
        Effect.gen(function* () {
          const jobs = yield* Jobs.make({ operationResponseBudgetMillis: 100 })
          yield* jobs.withTransaction(() =>
            Effect.gen(function* () {
              escaped = yield* JobEnqueue
              const standalone = yield* producer
                .enqueueStandalone({
                  slot: "receipt",
                  operationId: "one",
                  payload: "one"
                })
                .pipe(Effect.result)
              expect(standalone).toMatchObject({
                _tag: "Failure",
                failure: { reason: "active-transaction" }
              })
            })
          )
        }).pipe(Effect.provideService(PostgreSqlApplication, test.adapter))
      )
      const prepare = Effect.sync((): PreparedJob => {
        preparations++
        throw new Error("Escaped preparation must never run")
      })
      for (const effect of [
        escaped!.enqueue(prepare),
        escaped!.enqueueStandalone(prepare)
      ]) {
        const result = await Effect.runPromise(effect.pipe(Effect.result))
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "JobsTransactionClosed" }
        })
      }
      expect(preparations).toBe(0)
      expect(test.calls).toHaveLength(0)
    }
  )
})
