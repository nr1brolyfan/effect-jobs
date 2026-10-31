// Disposable owned PG only. Executes the exact compiled canonical application.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { Effect, Exit, Cause } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import { pgTable, text, integer } from "drizzle-orm/pg-core"
import { JobBackendError } from "effect-jobs/JobEnqueue"
import {
  ApplicationLayer,
  Database
} from "../../examples/docs/orders/packages/database/src/Database.js"
import {
  orders,
  orderReceipts,
  invoices,
  syntheticMail,
  jobTables
} from "../../examples/docs/orders/packages/database/src/schema.js"
import { migrationSql } from "../../examples/docs/orders/packages/database/src/Migrations.js"
import {
  placeOrderIdempotent as placeOrder,
  readOrderReceipt
} from "../../examples/docs/orders/apps/api/src/orders/PlaceOrderIdempotent.js"
import {
  PlaceOrder,
  placeOrder as createOrder
} from "../../examples/docs/orders/apps/api/src/orders/PlaceOrder.js"
import { placeOrder as placeOrderDirect } from "../../examples/docs/orders/apps/api/src/orders/Orders.js"
import {
  TransactionalEmails,
  EmailUnavailable
} from "../../examples/docs/orders/apps/api/src/orders/TransactionalEmails.js"
import { placeOrderWithInvoice } from "../../examples/docs/orders/apps/api/src/orders/PlaceOrderWithInvoice.js"
import { createInvoice } from "../../examples/docs/orders/apps/worker/src/orders/jobs/CreateInvoice.js"
import {
  drainOrders,
  drainConfirmations
} from "../../examples/docs/orders/apps/worker/src/main.js"
import {
  SendOrderConfirmation,
  SendInvoice,
  OrderPolicy
} from "../../examples/docs/orders/packages/orders/src/contracts/jobs.js"

import { qualifyBindings } from "./Bindings.mjs"
import * as Scenarios from "../../examples/docs/orders/apps/api/src/orders/SubmissionScenarios.js"
import { matchesSubmission } from "../../examples/docs/orders/apps/api/src/orders/OrderSubmission.js"

// Predicate controls independently cover absent rows, every field and both choices.
const retained = {
  operationId: "guard",
  orderId: "guard",
  sku: "book",
  quantity: 1,
  invoiceRequested: true
}
const submission = { operationId: "guard", orderId: "guard", sku: "book", quantity: 1 }
assert.equal(matchesSubmission(retained, submission, true), true)
assert.equal(matchesSubmission(undefined, submission, true), false)
assert.equal(matchesSubmission(retained, submission, false), false)
assert.equal(
  matchesSubmission({ ...retained, invoiceRequested: false }, submission, true),
  false
)
assert.equal(
  matchesSubmission({ ...retained, invoiceRequested: false }, submission, false),
  true
)
for (const changed of [
  { operationId: "other" },
  { orderId: "other" },
  { sku: "other" },
  { quantity: 2 }
]) {
  assert.equal(matchesSubmission({ ...retained, ...changed }, submission, true), false)
}

const port = Number(process.env.DOCS_TEST_PG_PORT)
assert(Number.isInteger(port) && port > 0)
const ClientLayer = PgClient.layer({
  host: "127.0.0.1",
  port,
  username: "postgres",
  database: "postgres",
  connectTimeout: "2 seconds",
  idleTimeout: "2 seconds",
  startupParameters: {
    statement_timeout: "2000",
    lock_timeout: "1000",
    idle_in_transaction_session_timeout: "5000"
  }
})
const audit = pgTable("order_transaction_audit", {
  tableName: text("table_name").notNull(),
  pid: integer("pid").notNull(),
  xid: text("xid").notNull()
})
const input = {
  operationId: "submission-1",
  orderId: "order-1",
  sku: "book",
  quantity: 1
}
const failure = (exit, tag) => {
  assert(Exit.isFailure(exit))
  assert.equal(Cause.squash(exit.cause)._tag, tag)
}
await Effect.runPromise(
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient
    for (const statement of migrationSql.split(";").filter((part) => part.trim())) {
      yield* pg.unsafe(statement)
    }
    // DDL instrumentation, never an application-query substitution.
    yield* pg.unsafe(
      "CREATE TABLE order_transaction_audit (table_name text NOT NULL, pid integer NOT NULL, xid text NOT NULL)"
    )
    yield* pg.unsafe(
      `CREATE FUNCTION order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO order_transaction_audit VALUES (TG_TABLE_NAME, pg_backend_pid(), txid_current()::text); RETURN NEW; END $$`
    )
    for (const table of [
      "orders",
      "jobs",
      "job_payloads",
      "order_receipts",
      "invoices",
      "synthetic_mail"
    ]) {
      yield* pg.unsafe(
        `CREATE TRIGGER order_audit AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION order_audit()`
      )
    }
    yield* Effect.gen(function* () {
      const db = yield* Database
      const counts = Effect.gen(function* () {
        return yield* Effect.forEach(
          [
            orders,
            jobTables.jobs,
            jobTables.payloads,
            orderReceipts,
            invoices,
            syntheticMail,
            audit
          ],
          (table) =>
            db
              .select()
              .from(table)
              .pipe(Effect.map((rows) => rows.length))
        )
      })
      // External trust boundary: reject before any transaction writes.
      assert(
        Exit.isFailure(yield* placeOrder({ ...input, quantity: "1" }).pipe(Effect.exit))
      )
      assert(
        Exit.isFailure(yield* placeOrder({ ...input, injected: true }).pipe(Effect.exit))
      )
      assert.deepEqual(yield* counts, [0, 0, 0, 0, 0, 0, 0])
      const first = yield* placeOrder(input)
      assert.equal(first._tag, "Inserted")
      const writes = yield* db.select().from(audit)
      assert.deepEqual(writes.map((r) => r.tableName).sort(), [
        "job_payloads",
        "jobs",
        "order_receipts",
        "orders"
      ])
      assert.equal(new Set(writes.map((r) => r.pid)).size, 1)
      assert.equal(new Set(writes.map((r) => r.xid)).size, 1)
      const duplicate = yield* placeOrder(input)
      assert.equal(duplicate._tag, "AlreadyPresent")
      assert.equal(duplicate.jobId, first.jobId)
      assert.deepEqual(yield* counts, [1, 1, 1, 1, 0, 0, 4])
      yield* drainConfirmations
      assert.equal((yield* db.select().from(syntheticMail)).length, 1)
      // Whole-operation semantics include fields absent from the job payload.
      for (const changed of [
        { sku: "different" },
        { quantity: 2 },
        { orderId: "different" }
      ]) {
        failure(
          yield* placeOrder({ ...input, ...changed }).pipe(Effect.exit),
          "OrderConflict"
        )
      }
      failure(yield* placeOrderWithInvoice(input).pipe(Effect.exit), "OrderConflict")
      failure(
        yield* placeOrder({ ...input, operationId: "other-operation" }).pipe(Effect.exit),
        "EffectDrizzleQueryError"
      )
      assert.deepEqual(yield* counts, [1, 1, 1, 1, 0, 1, 5])
      // Independent job semantic payload/catalog conflict under the SAME tuple.
      const identity = PlaceOrder.identity({
        operationId: input.operationId,
        slot: "send-confirmation"
      })
      failure(
        yield* pg
          .withTransaction(
            SendOrderConfirmation.enqueue({
              producer: identity,
              payload: { orderId: "changed" },
              policy: OrderPolicy
            })
          )
          .pipe(Effect.exit),
        "JobIntegrityConflict"
      )
      failure(
        yield* pg
          .withTransaction(
            SendInvoice.enqueue({
              producer: identity,
              payload: { invoiceId: input.orderId },
              policy: OrderPolicy
            })
          )
          .pipe(Effect.exit),
        "JobIntegrityConflict"
      )
      // Enqueue outside ambient owner fails without business or job writes.
      failure(
        yield* SendOrderConfirmation.enqueue({
          producer: PlaceOrder.identity({
            operationId: "missing-owner",
            slot: "send-confirmation"
          }),
          payload: { orderId: "missing" },
          policy: OrderPolicy
        }).pipe(Effect.exit),
        "JobBackendError"
      )
      // Last-write rejection must roll back ALL business/job/payload writes.
      yield* pg.unsafe(
        "ALTER TABLE order_receipts ADD CONSTRAINT reject_rollback CHECK (operation_id <> 'rollback')"
      )
      const before = yield* counts
      failure(
        yield* placeOrderWithInvoice({
          ...input,
          operationId: "rollback",
          orderId: "rollback"
        }).pipe(Effect.exit),
        "EffectDrizzleQueryError"
      )
      assert.deepEqual(yield* counts, before)
      assert.deepEqual(yield* readOrderReceipt("rollback"), [])
      // Concurrent matching submission: one order, two distinct consequences.
      const expanded = { ...input, operationId: "expanded", orderId: "expanded" }
      const concurrent = yield* Effect.forEach(
        [0, 1],
        () => placeOrderWithInvoice(expanded),
        { concurrency: 2 }
      )
      assert.equal(concurrent[0].confirmation.jobId, concurrent[1].confirmation.jobId)
      assert.equal(concurrent[0].invoice.jobId, concurrent[1].invoice.jobId)
      assert.notEqual(concurrent[0].confirmation.jobId, concurrent[0].invoice.jobId)
      assert.equal(
        (yield* db
          .select()
          .from(jobTables.jobs)
          .where(eq(jobTables.jobs.operationId, "expanded"))).length,
        2
      )
      assert.deepEqual(
        (yield* db
          .select()
          .from(jobTables.jobs)
          .where(eq(jobTables.jobs.operationId, "expanded")))
          .map((j) => j.slot)
          .sort(),
        ["create-invoice", "send-confirmation"]
      )
      // Dependence is explicit application code, repeatable even concurrently.
      const handoffs = yield* Effect.forEach([0, 1], () => createInvoice("expanded"), {
        concurrency: 2
      })
      assert.equal(handoffs[0].jobId, handoffs[1].jobId)
      const [invoice] = yield* db.select().from(invoices)
      assert.equal(invoice.orderId, "expanded")
      assert.equal(invoice.deliveryJobId, handoffs[0].jobId)
      const auditRows = yield* db.select().from(audit)
      const handoffXid = auditRows.find((r) => r.tableName === "invoices").xid
      const handoffWrites = auditRows.filter((r) => r.xid === handoffXid)
      assert.deepEqual(handoffWrites.map((r) => r.tableName).sort(), [
        "invoices",
        "job_payloads",
        "jobs"
      ])
      assert.equal(new Set(handoffWrites.map((r) => r.pid)).size, 1)
      assert.equal(new Set(handoffWrites.map((r) => r.xid)).size, 1)
      // Reject LAST invoice write: no delivery job/payload or invoice survives.
      yield* placeOrderWithInvoice({
        ...input,
        operationId: "handoff-rollback",
        orderId: "handoff-rollback"
      })
      yield* pg.unsafe(
        "ALTER TABLE invoices ADD CONSTRAINT reject_handoff CHECK (order_id <> 'handoff-rollback')"
      )
      const beforeHandoff = yield* counts
      assert(Exit.isFailure(yield* createInvoice("handoff-rollback").pipe(Effect.exit)))
      assert.deepEqual(yield* counts, beforeHandoff)
      yield* pg.unsafe("ALTER TABLE invoices DROP CONSTRAINT reject_handoff")
      // Synthetic acknowledgement loss AFTER durable real COMMIT. No network claim.
      let calls = 0
      const unknown = new JobBackendError({
        reason: "storage-failure",
        commitKnowledge: "Unknown"
      })
      const lostClient = {
        ...pg,
        /** @template A, E, R @param {Effect.Effect<A, E, R>} body */
        withTransaction: (body) => {
          calls++
          return pg.withTransaction(body).pipe(Effect.flatMap(() => Effect.fail(unknown)))
        }
      }
      const lost = yield* placeOrder({
        ...input,
        operationId: "lost",
        orderId: "lost"
      }).pipe(Effect.provideService(PgClient.PgClient, lostClient), Effect.exit)
      assert(Exit.isFailure(lost))
      assert.equal(Cause.squash(lost.cause), unknown)
      assert.equal(calls, 1)
      const beforeReads = yield* counts
      assert.equal((yield* readOrderReceipt("lost")).length, 1)
      assert.deepEqual(yield* readOrderReceipt("absent"), [])
      assert.deepEqual(yield* counts, beforeReads, "reconciliation performs no writes")
      // Worker actually uses the canonical handlers and synthetic mail adapter.
      yield* drainOrders
      yield* drainOrders
      const mail = yield* db.select().from(syntheticMail)
      assert.equal(
        mail.length,
        6,
        "four confirmations and two synthetic invoice deliveries"
      )
      assert.equal((yield* db.select().from(invoices)).length, 2)
      assert.equal(new Set(mail.map((m) => m.deliveryKey)).size, 6)
      assert(
        mail
          .filter((m) => m.subject === "Synthetic order invoice")
          .every((m) => m.body.includes("SYNTHETIC PDF STAND-IN"))
      )
      const completed = yield* db.select().from(jobTables.jobs)
      assert(completed.every((j) => j.state === "Completed"))
      const beforeReplay = yield* counts
      yield* createInvoice("expanded")
      yield* drainOrders
      assert.deepEqual(
        yield* counts,
        beforeReplay,
        "repeated completed handoff creates nothing"
      )
      yield* Scenarios.deliveryReasons
      yield* qualifyBindings(pg)
    }).pipe(Effect.provide(ApplicationLayer))
  }).pipe(Effect.provide(ClientLayer))
)
console.log(
  "PASS: real PG same PID/xid, whole-operation validation/uniqueness/concurrent replay, job semantic/catalog conflict, absent ambient owner, last-write rollback, independent slots, repeatable dependent handoff + rollback, synthetic post-COMMIT Unknown with read-only receipt reconciliation, actual workers + synthetic delivery"
)

// Execute the installed CLI boundaries too, with only this disposable database.
const cliEnvironment = {
  ...process.env,
  DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/postgres`,
  OPERATION_ID: "cli-submission",
  ORDER_ID: "cli-order",
  WITH_INVOICE: "false",
  WORKER_MODE: "confirmation"
}
const invoke = (file, env) => {
  const result = spawnSync(process.execPath, [file], {
    env,
    encoding: "utf8",
    timeout: 30000
  })
  assert.equal(result.status, 0, `CLI ${file}: ${result.stderr}`)
}
invoke("source/dist/apps/api/src/main.js", cliEnvironment)
invoke("source/dist/apps/worker/src/main.js", cliEnvironment)
const expandedEnvironment = {
  ...cliEnvironment,
  OPERATION_ID: "cli-expanded",
  ORDER_ID: "cli-expanded",
  WITH_INVOICE: "true",
  WORKER_MODE: "drain"
}
invoke("source/dist/apps/api/src/main.js", expandedEnvironment)
invoke("source/dist/apps/worker/src/main.js", expandedEnvironment)
invoke("source/dist/apps/worker/src/main.js", expandedEnvironment)
await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database
    assert.equal((yield* db.select().from(orders)).length, 6)
    assert.equal((yield* db.select().from(invoices)).length, 3)
    assert.equal((yield* db.select().from(syntheticMail)).length, 9)
  }).pipe(Effect.provide(ApplicationLayer), Effect.provide(ClientLayer))
)
console.log(
  "PASS: installed producer and worker CLI execution for confirmation-only and expanded invoice submissions"
)

await Effect.runPromise(
  Effect.gen(function* () {
    yield* Scenarios.twoConsequences
    yield* Scenarios.matchingReplay
    yield* Scenarios.businessConflict
    yield* Scenarios.payloadConflict
    yield* Scenarios.catalogConflict
  }).pipe(Effect.provide(ApplicationLayer), Effect.provide(ClientLayer))
)
console.log(
  "PASS: exact canonical expandable scenarios and replay predicate negative controls"
)

// Beginner creation has a deliberately different duplicate contract from replay.
await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database
    const pg = yield* PgClient.PgClient
    const snapshot = Effect.forEach(
      [orders, jobTables.jobs, jobTables.payloads, orderReceipts, audit],
      (table) =>
        db
          .select()
          .from(table)
          .pipe(Effect.map((rows) => rows.length))
    )
    const fresh = {
      operationId: "beginner",
      orderId: "beginner",
      sku: "book",
      quantity: 1
    }
    const before = yield* snapshot
    const first = yield* createOrder(fresh)
    assert.equal(first._tag, "Inserted")
    const after = yield* snapshot
    assert.deepEqual(
      after,
      before.map((n, i) => n + [1, 1, 1, 0, 3][i])
    )
    const writes = (yield* db.select().from(audit)).slice(-3)
    assert.deepEqual(writes.map((row) => row.tableName).sort(), [
      "job_payloads",
      "jobs",
      "orders"
    ])
    assert.equal(new Set(writes.map((row) => row.pid)).size, 1)
    assert.equal(new Set(writes.map((row) => row.xid)).size, 1)
    for (const duplicate of [
      fresh,
      { ...fresh, orderId: "beginner-other" },
      { ...fresh, quantity: 2 }
    ]) {
      failure(yield* createOrder(duplicate).pipe(Effect.exit), "EffectDrizzleQueryError")
      assert.deepEqual(
        yield* snapshot,
        after,
        "duplicate rejects without any domain/job/audit writes"
      )
    }
    yield* pg.unsafe(
      "ALTER TABLE jobs ADD CONSTRAINT reject_beginner_enqueue CHECK (operation_id <> 'beginner-rollback')"
    )
    failure(
      yield* createOrder({
        ...fresh,
        operationId: "beginner-rollback",
        orderId: "beginner-rollback"
      }).pipe(Effect.exit),
      "JobBackendError"
    )
    assert.deepEqual(
      yield* snapshot,
      after,
      "enqueue failure rolls back order, job, payload and audit"
    )
    yield* pg.unsafe("ALTER TABLE jobs DROP CONSTRAINT reject_beginner_enqueue")
    // Execute the opening example too: successful send and failure after committed order.
    let sends = 0
    const direct = { ...fresh, operationId: "without-jobs", orderId: "without-jobs" }
    yield* placeOrderDirect(direct).pipe(
      Effect.provideService(
        TransactionalEmails,
        TransactionalEmails.of({
          sendOrderConfirmation: () =>
            Effect.sync(() => {
              sends++
            })
        })
      )
    )
    assert.equal(sends, 1)
    const failed = {
      ...fresh,
      operationId: "without-jobs-failed",
      orderId: "without-jobs-failed"
    }
    failure(
      yield* placeOrderDirect(failed).pipe(
        Effect.provideService(
          TransactionalEmails,
          TransactionalEmails.of({
            sendOrderConfirmation: () => Effect.fail(new EmailUnavailable())
          })
        ),
        Effect.exit
      ),
      "EmailUnavailable"
    )
    assert.equal(
      (yield* db.select().from(orders).where(eq(orders.operationId, failed.operationId)))
        .length,
      1
    )
    assert.equal(
      (yield* db
        .select()
        .from(jobTables.jobs)
        .where(eq(jobTables.jobs.operationId, failed.operationId))).length,
      0
    )
  }).pipe(Effect.provide(ApplicationLayer), Effect.provide(ClientLayer))
)
console.log(
  "PASS: beginner same-client atomic create, duplicate rejection, enqueue rollback; opening without-jobs success/failure window; advanced replay remains independently qualified"
)

await Effect.runPromise(
  Effect.gen(function* () {
    yield* Scenarios.duplicateCreate
    yield* Scenarios.idempotentSubmissionReplay
  }).pipe(Effect.provide(ApplicationLayer), Effect.provide(ClientLayer))
)
console.log(
  "PASS: exact beginner duplicate and advanced idempotent replay/conflict content scenarios"
)
