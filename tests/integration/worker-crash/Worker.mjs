/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Private subprocess fixture reports sanitized status over IPC. */
import { readFileSync } from "node:fs"
import pg from "pg"
import { Effect, Layer } from "effect"
import * as Codec from "../../../dist/JobPayloadCodec.js"
import * as Registry from "../../../dist/JobRegistry.js"
import * as Worker from "../../../dist/JobWorker.js"
import * as Consumer from "../../../dist/JobConsumer.js"
import * as Runtime from "../../../dist/JobWorkerRuntime.js"
import { definition, queue, makeBackend } from "./Scenario.mjs"

const { connection } = JSON.parse(readFileSync(process.argv[2], "utf8"))
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
  composition = await makeBackend(connection)
  const { backend, runtime } = composition
  const store = {
    ...backend.store,
    claim: (request) =>
      backend.store.claim(request).pipe(
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
  const handler = definition.handlerLayer(
    ({ payload }) =>
      Effect.gen(function* () {
        // Separate committed provider ledger, outside the queue transaction. The key is
        // the business consequence, never the attempt/lease/process ID.
        yield* Effect.tryPromise(() =>
          provider.query(
            `INSERT INTO crash_provider.effects (idempotency_key,requests)
      VALUES ($1,1) ON CONFLICT (idempotency_key) DO UPDATE SET requests=crash_provider.effects.requests+1`,
            [payload.consequenceId]
          )
        )
        yield* Effect.sync(() => send({ type: "effect-committed" }))
        if (hold) {
          yield* Effect.promise(() => resumed)
        }
      }),
    Codec.decodeJobPayload
  )
  const consumer = await runtime.runPromise(
    Consumer.make(queue, {
      localConcurrency: 1,
      claimLimitPerRun: 1,
      recoveryLimitPerRun: 1
    })
  )
  const result = await runtime.runPromise(
    Runtime.drain(consumer).pipe(
      Effect.provide(
        Worker.layer(store, {
          catalog: [definition],
          operationResponseBudgetMillis: 1000
        }).pipe(Layer.provide(handler), Layer.provide(Registry.layer))
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
