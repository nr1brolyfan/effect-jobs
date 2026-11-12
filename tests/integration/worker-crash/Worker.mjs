/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Private subprocess fixture reports sanitized status over IPC. */
import { readFileSync } from "node:fs"
import pg from "pg"
import { Effect, Layer } from "effect"
import * as Worker from "../../../dist/JobWorker.js"
import * as Storage from "../../../dist/JobStorage.js"
import * as JobApiBuilder from "../../../dist/JobApiBuilder.js"
import { api, queue, makeJobs } from "./Scenario.mjs"

const configuration = JSON.parse(readFileSync(process.argv[2], "utf8"))
const connection = configuration.connection
const hold = process.argv[3] === "hold"
const send = (message) => process.send?.(message)
const provider = new pg.Pool({
  ...connection,
  user: "crash_runtime",
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 2000,
  query_timeout: 3000
})
let resume
const resumed = new Promise((resolve) => {
  resume = resolve
})
process.on("message", (message) => {
  if (message === "resume") {
    resume()
  }
})
let composition
try {
  composition = await makeJobs(connection)
  const { jobs, runtime } = composition
  const store = {
    ...jobs.store,
    claim: (request) =>
      jobs.store.claim(request).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Claimed") {
              send({
                type: "claimed",
                ownership: result.claim.ownership,
                snapshot: result.claim.snapshot
              })
            }
          })
        )
      )
  }
  const handler = JobApiBuilder.group(api, "crash", (handlers) =>
    handlers.handle("delivery", (input) =>
      Effect.gen(function* () {
        // Separate committed provider ledger, outside the queue transaction. The key is
        // the business consequence, never the attempt/lease/process ID.
        yield* Effect.tryPromise(() =>
          provider.query(
            `INSERT INTO crash_provider.effects (idempotency_key,requests)
      VALUES ($1,1) ON CONFLICT (idempotency_key) DO UPDATE SET requests=crash_provider.effects.requests+1`,
            [input.payload.consequenceId]
          )
        )
        yield* Effect.sync(() => send({ type: "effect-committed" }))
        if (hold) {
          yield* Effect.promise(() => resumed)
        }
      })
    )
  )
  const result = await runtime.runPromise(
    Worker.drain(queue, { maxJobs: 1, recoveryLimit: 1 }).pipe(
      Effect.provide(
        Worker.layer(api, { queues: [{ queue, concurrency: 1 }] }).pipe(
          Layer.provide(
            Layer.mergeAll(
              handler,
              Storage.layer({ store, operationResponseBudgetMillis: 1000 })
            )
          )
        )
      )
    )
  )
  send({ type: "drained", result })
} catch {
  send({ type: "failed" })
  process.exitCode = 1
} finally {
  await composition?.runtime.dispose()
  await provider.end()
  process.disconnect?.()
}
