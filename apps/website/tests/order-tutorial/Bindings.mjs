// Current packed API and physical V1 rows against the owned order fixture.
import assert from "node:assert/strict"
import { Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import {
  initialDelivery,
  deliberateResend,
  customerCopy,
  accountantCopy
} from "../../examples/docs/orders/apps/api/src/orders/InvoiceDelivery.js"

/** @param {import("effect/sql/SqlClient").SqlClient} pg */
export const qualifyBindings = (pg) =>
  Effect.gen(function* () {
    const queue = Queue.make("binding-fixture")
    const definition = Job.make({
      name: "invoice.binding",
      queue,
      payload: Schema.String,
      defaultPolicy: Policy.defaultPolicy
    })
    const nextDefault = Job.make({
      name: definition.name,
      queue,
      payload: Schema.String,
      defaultPolicy: Policy.make({ maxAttempts: 5 })
    })
    const otherQueue = Job.make({
      name: definition.name,
      queue: Queue.make("binding-other"),
      payload: Schema.String,
      defaultPolicy: Policy.defaultPolicy
    })
    const producer = Producer.make({
      operation: "binding.operation",
      slots: { invoice: definition, copy: definition, other: otherQueue }
    })
    const encoded = yield* Codec.encodeJobPayload(definition.payload, "pre-existing")
    // Exact original physical columns and V1 bytes. No rename/ALTER/UPDATE/backfill.
    yield* pg.withTransaction(
      Effect.gen(function* () {
        yield* pg.unsafe(
          `INSERT INTO jobs (id,operation,operation_id,slot,queue,kind,version,policy,initial_available_at,state,available_at,updated_at) VALUES ('pre-existing-kind','binding.operation','old','invoice','binding-fixture','invoice.binding',1,$1::jsonb,100,'Pending',100,100)`,
          [JSON.stringify(Policy.defaultPolicy)]
        )
        yield* pg.unsafe(
          `INSERT INTO job_payloads (job_id,format_version,payload,projection) VALUES ('pre-existing-kind',1,$1,$2)`,
          [encoded.payloadBytes, encoded.semanticProjectionBytes]
        )
      })
    )
    const prior = yield* pg.withTransaction(
      producer.enqueue("invoice", { operationId: "old", payload: "pre-existing" })
    )
    assert.equal(prior._tag, "AlreadyPresent")
    assert.equal(prior.jobId, "pre-existing-kind")
    let handled = 0
    const backend = yield* PostgreSqlJobs
    const worker = Worker.layer(backend.store, {
      catalog: [definition],
      operationResponseBudgetMillis: 100
    }).pipe(
      Layer.provide(
        definition.handlerLayer(
          (input) =>
            Effect.sync(() => {
              assert.equal(input.context.catalog.name, definition.name)
              assert.equal(input.payload, "pre-existing")
              handled++
            }),
          Codec.decodeJobPayload
        )
      ),
      Layer.provide(Registry.layer)
    )
    yield* Effect.gen(function* () {
      const configured = yield* Consumer.make(queue, {
        localConcurrency: 1,
        claimLimitPerRun: 10,
        recoveryLimitPerRun: 10
      })
      yield* Runtime.drain(configured)
    }).pipe(Effect.provide(worker))
    assert.equal(handled, 1)
    const duplicate = yield* pg.withTransaction(
      nextDefault.enqueue({
        producer: producer.identity({ operationId: "old", slot: "invoice" }),
        payload: "pre-existing"
      })
    )
    assert.equal(duplicate.jobId, prior.jobId)
    const [stored] = yield* pg.unsafe(
      "SELECT kind,policy,initial_available_at,state FROM jobs WHERE id=$1",
      [prior.jobId]
    )
    assert.equal(stored.kind, definition.name)
    assert.equal(stored.policy.maxAttempts, 3)
    assert.equal(Number(stored.initial_available_at), 100)
    assert.equal(stored.state, "Completed")
    // New defaults, full overrides and first policy/availability all survive replay.
    const freshInput = {
      producer: producer.identity({ operationId: "new", slot: "invoice" }),
      payload: "fresh",
      availableAt: 200
    }
    const fresh = yield* pg.withTransaction(nextDefault.enqueue(freshInput))
    yield* pg.withTransaction(
      nextDefault.enqueue({
        ...freshInput,
        availableAt: 400,
        policy: Policy.make({ maxAttempts: 1 })
      })
    )
    const [freshRow] = yield* pg.unsafe(
      "SELECT policy,initial_available_at FROM jobs WHERE id=$1",
      [fresh.jobId]
    )
    assert.equal(freshRow.policy.maxAttempts, 5)
    assert.equal(Number(freshRow.initial_available_at), 200)
    const override = yield* pg.withTransaction(
      nextDefault.enqueue({
        ...freshInput,
        producer: producer.identity({ operationId: "override", slot: "invoice" }),
        policy: Policy.make({ maxAttempts: 1 })
      })
    )
    assert.equal(
      (yield* pg.unsafe("SELECT policy FROM jobs WHERE id=$1", [override.jobId]))[0]
        .policy.maxAttempts,
      1
    )
    const replayInput = { operationId: "concurrent", payload: "recipient" }
    const concurrent = yield* Effect.all(
      [
        pg.withTransaction(producer.enqueue("copy", replayInput)),
        pg.withTransaction(producer.enqueue("copy", replayInput))
      ],
      { concurrency: 2 }
    )
    assert.equal(concurrent[0].jobId, concurrent[1].jobId)
    assert.deepEqual(
      concurrent.map((r) => r._tag).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["AlreadyPresent", "Inserted"]
    )
    // The same tuple in another queue is a conflict, not a separate namespace.
    for (const changed of [
      otherQueue,
      Job.make({
        name: "invoice.other",
        queue,
        payload: Schema.String,
        defaultPolicy: Policy.defaultPolicy
      })
    ]) {
      const exit = yield* pg
        .withTransaction(
          changed.enqueue({
            producer: producer.identity({ operationId: "concurrent", slot: "copy" }),
            payload: "recipient"
          })
        )
        .pipe(Effect.exit)
      assert.equal(exit._tag, "Failure")
      assert.equal(exit.cause.reasons[0].error._tag, "JobIntegrityConflict")
    }
    const slots = yield* pg.withTransaction(
      Effect.gen(function* () {
        const invoice = yield* producer.enqueue("invoice", {
          operationId: "slots",
          payload: "customer"
        })
        const copy = yield* producer.enqueue("copy", {
          operationId: "slots",
          payload: "accountant"
        })
        const other = yield* producer.enqueue("other", {
          operationId: "slots",
          payload: "independent queue"
        })
        return [invoice, copy, other]
      })
    )
    assert.equal(new Set(slots.map((r) => r.jobId)).size, 3)
    const recipes = yield* pg.withTransaction(
      Effect.all([initialDelivery, deliberateResend, customerCopy, accountantCopy])
    )
    assert.equal(new Set(recipes.map((r) => r.jobId)).size, 4)
    const replay = yield* pg.withTransaction(initialDelivery)
    assert.equal(replay.jobId, recipes[0].jobId)
    console.log(
      "PASS: pre-existing physical kind read/compare/worker; defaults/overrides/first-write persistence; concurrent bound replay; cross-queue/name conflict; same-job distinct slots; independent queues; canonical initial/resend/recipient recipes"
    )
  })
