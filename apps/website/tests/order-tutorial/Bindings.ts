import assert from "node:assert/strict"
import type { SqlClient } from "effect/sql/SqlClient"
import { Duration, Effect, Layer, Schema, Cause, Exit } from "effect"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Group from "effect-jobs/JobGroup"
import * as Api from "effect-jobs/JobApi"
import * as Builder from "effect-jobs/JobApiBuilder"
import * as Storage from "effect-jobs/JobStorage"
import * as Retry from "effect-jobs/JobRetryPolicy"
import * as Worker from "effect-jobs/JobWorker"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import {
  initialDelivery,
  deliberateResend,
  customerCopy,
  accountantCopy
} from "../../examples/docs/orders/apps/api/src/orders/InvoiceDelivery.js"
// Native SQL APIs are intentionally pinned to Effect 4.1.0 by this qualification.
// @effect-diagnostics unstableApiUsage:off
// Current packed API and physical V1 rows against the owned order fixture.

/** @param {import("effect/sql/SqlClient").SqlClient} pg */
export const qualifyBindings = (pg: SqlClient) =>
  Effect.gen(function* () {
    const queue = Queue.make("binding-fixture")
    const definition = yield* Job.make({
      name: "invoice.binding",
      payload: Schema.String
    })
    const nextPolicy = yield* Policy.make({
      retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxFinalizedAttempts(5))
    })
    const overridePolicy = yield* Policy.make({
      retry: Retry.fixed(Duration.seconds(5)).pipe(Retry.maxFinalizedAttempts(1))
    })
    const producer = yield* Producer.make("binding.operation").pipe(
      Producer.withSlot("invoice", definition, { queue }),
      Producer.withSlot("copy", definition, { queue }),
      Producer.withSlot("other", definition, { queue: Queue.make("binding-other") })
    )
    const nextDefault = yield* Producer.make("binding.operation").pipe(
      Producer.withSlot("invoice", definition, { queue, policy: nextPolicy })
    )
    const otherQueue = yield* Producer.make("binding.operation").pipe(
      Producer.withSlot("copy", definition, { queue: Queue.make("binding-other") })
    )
    const encoded = yield* Codec.encodeJobPayload(definition.payload, "pre-existing")
    // Exact original physical columns and V1 bytes. No rename/ALTER/UPDATE/backfill.
    yield* pg.withTransaction(
      Effect.gen(function* () {
        yield* pg.unsafe(
          `INSERT INTO jobs (id,operation,operation_id,slot,queue,kind,version,policy,initial_available_at,state,available_at,updated_at) VALUES ('pre-existing-kind','binding.operation','old','invoice','binding-fixture','invoice.binding',1,$1::jsonb,100,'Pending',100,100)`,
          [
            JSON.stringify(
              yield* Schema.encodeEffect(Policy.PersistedJobPolicy)(Policy.defaultPolicy)
            )
          ]
        )
        yield* pg.unsafe(
          `INSERT INTO job_payloads (job_id,format_version,payload,projection) VALUES ('pre-existing-kind',1,$1,$2)`,
          [encoded.payloadBytes, encoded.semanticProjectionBytes]
        )
      })
    )
    const prior = yield* pg.withTransaction(
      producer.enqueue({ slot: "invoice", operationId: "old", payload: "pre-existing" })
    )
    assert.equal(prior._tag, "AlreadyPresent")
    assert.equal(prior.jobId, "pre-existing-kind")
    let handled = 0
    const jobs = yield* PostgreSqlJobs
    const bindings = Group.make("bindings", { invoice: definition })
    const catalog = Api.make("binding-fixture").pipe(Api.addGroup(bindings))
    const worker = Worker.layer(catalog, { queues: [{ queue, concurrency: 1 }] }).pipe(
      Layer.provide(
        Builder.group(catalog, "bindings", (handlers) =>
          handlers.handle("invoice", (input) =>
            Effect.sync(() => {
              assert.equal(input.context.catalog.name, definition.name)
              assert.equal(input.payload, "pre-existing")
              handled++
            })
          )
        )
      ),
      Layer.provide(Layer.succeed(Storage.JobStorage, jobs.storage))
    )
    yield* Worker.drain(queue, { maxJobs: 10, recoveryLimit: 10 }).pipe(
      Effect.provide(worker)
    )
    assert.equal(handled, 1)
    const duplicate = yield* pg.withTransaction(
      nextDefault.enqueue({
        slot: "invoice",
        operationId: "old",
        payload: "pre-existing"
      })
    )
    assert.equal(duplicate.jobId, prior.jobId)
    const [stored] = yield* pg.unsafe<{
      kind: string
      policy: { readonly maxAttempts: number }
      initial_available_at: number | string
      state: string
    }>("SELECT kind,policy,initial_available_at,state FROM jobs WHERE id=$1", [
      prior.jobId
    ])
    assert(stored)
    assert.equal(stored.kind, definition.name)
    assert.equal(stored.policy.maxAttempts, 3)
    assert.equal(Number(stored.initial_available_at), 100)
    assert.equal(stored.state, "Completed")
    // New defaults, full overrides and first policy/availability all survive replay.
    const freshInput = {
      slot: "invoice" as const,
      operationId: "new",
      payload: "fresh",
      availableAt: 200
    }
    const fresh = yield* pg.withTransaction(nextDefault.enqueue(freshInput))
    yield* pg.withTransaction(
      nextDefault.enqueue({
        ...freshInput,
        availableAt: 400,
        policy: overridePolicy
      })
    )
    const [freshRow] = yield* pg.unsafe<{
      policy: { readonly maxAttempts: number }
      initial_available_at: number | string
    }>("SELECT policy,initial_available_at FROM jobs WHERE id=$1", [fresh.jobId])
    assert(freshRow)
    assert.equal(freshRow.policy.maxAttempts, 5)
    assert.equal(Number(freshRow.initial_available_at), 200)
    const override = yield* pg.withTransaction(
      nextDefault.enqueue({
        ...freshInput,
        operationId: "override",
        policy: overridePolicy
      })
    )
    assert.equal(
      (yield* pg.unsafe<{ policy: { readonly maxAttempts: number } }>(
        "SELECT policy FROM jobs WHERE id=$1",
        [override.jobId]
      ))[0]!.policy.maxAttempts,
      1
    )
    const replayInput = { operationId: "concurrent", payload: "recipient" }
    const concurrent = yield* Effect.all(
      [
        pg.withTransaction(producer.enqueue({ slot: "copy", ...replayInput })),
        pg.withTransaction(producer.enqueue({ slot: "copy", ...replayInput }))
      ],
      { concurrency: 2 }
    )
    assert.equal(concurrent[0].jobId, concurrent[1].jobId)
    assert.deepEqual(
      concurrent.map((r) => r._tag).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["AlreadyPresent", "Inserted"]
    )
    // Queue selection is execution configuration, independent of contract semantics.
    const rerouted = yield* pg.withTransaction(
      otherQueue.enqueue({
        slot: "copy",
        operationId: "concurrent",
        payload: "recipient"
      })
    )
    assert.equal(rerouted.jobId, concurrent[0].jobId)
    assert.equal(
      (yield* pg.unsafe<{ queue: string }>("SELECT queue FROM jobs WHERE id=$1", [
        rerouted.jobId
      ]))[0]!.queue,
      queue.name
    )
    const changedDefinition = yield* Job.make({
      name: "invoice.other",
      payload: Schema.String
    })
    const changed = yield* Producer.make("binding.operation").pipe(
      Producer.withSlot("copy", changedDefinition, { queue })
    )
    const exit = yield* pg
      .withTransaction(
        changed.enqueue({ slot: "copy", operationId: "concurrent", payload: "recipient" })
      )
      .pipe(Effect.exit)
    assert(Exit.isFailure(exit))
    assert.equal(
      Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }))(
        Cause.squash(exit.cause)
      )._tag,
      "JobIntegrityConflict"
    )
    const slots = yield* pg.withTransaction(
      Effect.gen(function* () {
        const invoice = yield* producer.enqueue({
          slot: "invoice",
          operationId: "slots",
          payload: "customer"
        })
        const copy = yield* producer.enqueue({
          slot: "copy",
          operationId: "slots",
          payload: "accountant"
        })
        const other = yield* producer.enqueue({
          slot: "other",
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
      "PASS: pre-existing physical kind read/compare/worker; defaults/overrides/first-write persistence; concurrent bound replay; first-write queue routing/name conflict; same-job distinct slots; independent queues; canonical initial/resend/recipient recipes"
    )
  })
