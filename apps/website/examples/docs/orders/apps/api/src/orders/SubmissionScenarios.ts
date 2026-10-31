// Checked examples: run against an empty qualification database, outside a worker.
// #region imports
import assert from "node:assert/strict"
import { Effect, Result } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { SendInvoice } from "#orders/contracts/jobs"
import {
  placeOrderWithInvoice,
  PlaceOrderWithInvoice
} from "#api/orders/PlaceOrderWithInvoice"
import { placeOrder } from "#api/orders/PlaceOrder"
import { placeOrderIdempotent } from "#api/orders/PlaceOrderIdempotent"
import {
  initialDelivery,
  deliberateResend,
  customerCopy,
  accountantCopy
} from "#api/orders/InvoiceDelivery"
// #endregion imports

// #region two-consequences
export const twoConsequences = Effect.gen(function* () {
  const result = yield* placeOrderWithInvoice({
    operationId: "example-two",
    orderId: "example-two",
    sku: "book",
    quantity: 1
  })
  assert.equal(result.confirmation._tag, "Inserted")
  assert.equal(result.invoice._tag, "Inserted")
  // One submission, two slots: distinct generated IDs, no execution order.
  assert.notEqual(result.confirmation.jobId, result.invoice.jobId)
})
// #endregion two-consequences

// #region matching-replay
export const matchingReplay = Effect.gen(function* () {
  const input = {
    operationId: "example-replay",
    orderId: "example-replay",
    sku: "book",
    quantity: 1
  }
  const first = yield* placeOrderWithInvoice(input)
  const replay = yield* placeOrderWithInvoice(input)
  assert.equal(first.confirmation._tag, "Inserted")
  assert.equal(replay.confirmation._tag, "AlreadyPresent")
  assert.equal(replay.invoice._tag, "AlreadyPresent")
  // Compare returned IDs; their generated values are not predictable.
  assert.equal(replay.confirmation.jobId, first.confirmation.jobId)
  assert.equal(replay.invoice.jobId, first.invoice.jobId)
})
// #endregion matching-replay

// #region business-conflict
export const businessConflict = Effect.gen(function* () {
  const input = {
    operationId: "example-business",
    orderId: "example-business",
    sku: "book",
    quantity: 1
  }
  yield* placeOrderWithInvoice(input)
  // Same operation and queued orderId, but different business quantity.
  const exit = yield* placeOrderWithInvoice({ ...input, quantity: 2 }).pipe(Effect.result)
  // Observe failure OUTSIDE the transaction owner, after rollback.
  assert(Result.isFailure(exit))
  assert.equal(exit.failure._tag, "OrderConflict")
  const changedInvoiceChoice = yield* placeOrderIdempotent(input).pipe(Effect.result)
  assert(Result.isFailure(changedInvoiceChoice))
  assert.equal(changedInvoiceChoice.failure._tag, "OrderConflict")
})
// #endregion business-conflict

// #region payload-conflict
export const payloadConflict = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const input = { operationId: "example-payload", payload: { orderId: "order-a" } }
  yield* pg.withTransaction(PlaceOrderWithInvoice.enqueue("send-confirmation", input))
  const exit = yield* pg
    .withTransaction(
      PlaceOrderWithInvoice.enqueue("send-confirmation", {
        ...input,
        payload: { orderId: "order-b" }
      })
    )
    .pipe(Effect.result)
  // Same tuple, different payload: rollback, not a second job.
  assert(Result.isFailure(exit))
  assert.equal(exit.failure._tag, "JobIntegrityConflict")
})
// #endregion payload-conflict

// #region catalog-conflict
export const catalogConflict = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const operationId = "example-catalog"
  yield* pg.withTransaction(
    PlaceOrderWithInvoice.enqueue("send-confirmation", {
      operationId,
      payload: { orderId: "order-a" }
    })
  )
  // Explicit low-level identity is structural, not a typed slot/job binding.
  const exit = yield* pg
    .withTransaction(
      SendInvoice.enqueue({
        producer: PlaceOrderWithInvoice.identity({
          operationId,
          slot: "send-confirmation"
        }),
        payload: { invoiceId: "order-a" }
      })
    )
    .pipe(Effect.result)
  assert(Result.isFailure(exit))
  assert.equal(exit.failure._tag, "JobIntegrityConflict")
})
// #endregion catalog-conflict

// #region delivery-reasons
export const deliveryReasons = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  // Different operations for initial/resend; distinct slots for recipient copies.
  const results = yield* pg.withTransaction(
    Effect.all([initialDelivery, deliberateResend, customerCopy, accountantCopy])
  )
  assert(results.every((result) => result._tag === "Inserted"))
  assert.equal(new Set(results.map((result) => result.jobId)).size, 4)
  const replay = yield* pg.withTransaction(initialDelivery)
  assert.equal(replay._tag, "AlreadyPresent")
  assert.equal(replay.jobId, results[0]?.jobId)
})
// #endregion delivery-reasons

// #region duplicate-create
export const duplicateCreate = Effect.gen(function* () {
  const input = {
    operationId: "example-create",
    orderId: "example-create",
    sku: "book",
    quantity: 1
  }
  const first = yield* placeOrder(input)
  assert.equal(first._tag, "Inserted")
  const duplicate = yield* placeOrder(input).pipe(Effect.result)
  // Observed outside the owner: the duplicate transaction has rolled back.
  assert(Result.isFailure(duplicate))
  assert.equal(duplicate.failure._tag, "EffectDrizzleQueryError")
})
// #endregion duplicate-create

// #region advanced-replay
export const idempotentSubmissionReplay = Effect.gen(function* () {
  const input = {
    operationId: "example-advanced",
    orderId: "example-advanced",
    sku: "book",
    quantity: 1
  }
  const first = yield* placeOrderIdempotent(input)
  const replay = yield* placeOrderIdempotent(input)
  assert.equal(first._tag, "Inserted")
  assert.equal(replay._tag, "AlreadyPresent")
  assert.equal(replay.jobId, first.jobId)
  const changed = yield* placeOrderIdempotent({ ...input, quantity: 2 }).pipe(
    Effect.result
  )
  assert(Result.isFailure(changed))
  assert.equal(changed.failure._tag, "OrderConflict")
})
// #endregion advanced-replay
