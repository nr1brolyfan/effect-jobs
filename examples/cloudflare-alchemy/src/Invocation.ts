// @effect-diagnostics unstableApiUsage:off
// The native HTTP/SQL APIs are intentionally pinned to Effect 4.1.0.
import * as Pg from "@effect/sql-pg/PgClient"
import * as Reactivity from "effect/reactivity/Reactivity"
import { Effect, Layer } from "effect"
import type { Redacted } from "effect"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Worker from "effect-jobs/JobWorker"
import * as Storage from "effect-jobs/JobStorage"
import * as Schedule from "effect-jobs/JobSchedule"
import {
  AdmissionRejected,
  Definitions,
  DefinitionsLayer,
  BillingQueue,
  Handlers,
  InvoiceDelivery,
  OperationUnconfirmed
} from "./Domain.js"
import type { IssueRequest } from "./Domain.js"

export interface Settings<R = never> {
  readonly databaseUrl:
    | Redacted.Redacted<string>
    | Effect.Effect<Redacted.Redacted<string>, never, R>
  readonly providerUrl: string
}

// Evaluate INSIDE each RPC/callback. No client, transaction or pool escapes its Scope.
export const openInvocation = <R = never>(settings: Settings<R>) =>
  Effect.gen(function* () {
    const declarations = yield* Definitions
    const client = yield* Pg.make({
      applicationName: "effect-jobs-alchemy-example",
      url: Effect.isEffect(settings.databaseUrl)
        ? yield* settings.databaseUrl
        : settings.databaseUrl,
      minConnections: 0,
      maxConnections: 2,
      prepare: false,
      connectTimeout: "2 seconds",
      acquireTimeout: "2 seconds",
      idleTimeout: "1 second",
      startupParameters: {
        statement_timeout: "2000",
        lock_timeout: "1000",
        idle_in_transaction_session_timeout: "5000"
      }
    })
    const jobs = yield* Jobs.make({
      schema: "alchemy_example",
      operationResponseBudgetMillis: 500
    }).pipe(
      Effect.provideService(
        PostgreSqlApplication,
        Native.make({ client, operationTimeoutMillis: 2500 })
      )
    )
    yield* jobs.ready
    const lookup = (tenantId: string, invoiceId: string) =>
      client<{ invoice_id: string }>`
    SELECT i.invoice_id FROM alchemy_example.invoices i
    JOIN alchemy_example.tenants t ON t.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId} AND i.invoice_id = ${invoiceId} AND t.enabled = true
  `.pipe(
        Effect.flatMap((rows) =>
          rows.length === 1
            ? Effect.succeed(rows[0]!)
            : Effect.fail(new AdmissionRejected())
        )
      )

    // DEVELOPMENT provider: the harness implements an idempotent HTTP effect sink.
    // A real provider must persist the key and bind it to equal request content.
    const DeliveryLayer = Layer.succeed(InvoiceDelivery, {
      deliver: (tenantId, invoiceId, idempotencyKey) =>
        Effect.gen(function* () {
          yield* lookup(tenantId, invoiceId).pipe(
            Effect.mapError((error) =>
              error instanceof AdmissionRejected ? error : new OperationUnconfirmed()
            )
          )
          const response = yield* Effect.tryPromise({
            try: (signal) =>
              fetch(settings.providerUrl, {
                method: "POST",
                signal,
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": idempotencyKey
                },
                body: JSON.stringify({ tenantId, invoiceId })
              }),
            catch: () => new OperationUnconfirmed()
          }).pipe(
            Effect.timeoutOrElse({
              duration: "2 seconds",
              orElse: () => Effect.fail(new OperationUnconfirmed())
            })
          )
          if (!response.ok) {
            return yield* new OperationUnconfirmed()
          }
        })
    })
    const WorkerLayer = Worker.layer(declarations.api, {
      queues: [{ queue: BillingQueue, concurrency: 1 }]
    }).pipe(
      Layer.provide(Layer.succeed(Storage.JobStorage, jobs.storage)),
      Layer.provide(
        Handlers.pipe(
          Layer.provide(DeliveryLayer),
          Layer.provide(Layer.succeed(Definitions, declarations))
        )
      )
    )
    return {
      issue: (tenantId: string, request: IssueRequest) =>
        client.withTransaction(
          Effect.gen(function* () {
            yield* lookup(tenantId, request.invoiceId)
            // Application-owned, globally unambiguous ID across tenants. Stable on retries.
            const operationId = `${tenantId}/${request.requestId}`
            yield* client`INSERT INTO alchemy_example.receipts (operation_id, tenant_id, invoice_id)
        VALUES (${operationId}, ${tenantId}, ${request.invoiceId}) ON CONFLICT DO NOTHING`
            const receipts = yield* client<{ invoice_id: string; job_id: string | null }>`
        SELECT invoice_id, job_id FROM alchemy_example.receipts
        WHERE operation_id = ${operationId} AND tenant_id = ${tenantId} FOR UPDATE`
            const receipt = receipts[0]
            if (!receipt || receipt.invoice_id !== request.invoiceId) {
              return yield* new AdmissionRejected()
            }
            if (receipt.job_id !== null) {
              return { jobId: receipt.job_id }
            }
            yield* client`UPDATE alchemy_example.invoices SET issued = true WHERE tenant_id = ${tenantId} AND invoice_id = ${request.invoiceId}`
            const produced = yield* declarations.IssueInvoice.enqueue({
              operationId,
              slot: "deliver",
              payload: { tenantId, invoiceId: request.invoiceId }
            })
            yield* client`UPDATE alchemy_example.receipts SET job_id = ${produced.jobId} WHERE operation_id = ${operationId}`
            return { jobId: produced.jobId }
          }).pipe(Effect.provideService(JobEnqueue, jobs.producer))
        ),
      drain: Worker.drain(BillingQueue, { maxJobs: 4, recoveryLimit: 4 }).pipe(
        Effect.provide(WorkerLayer)
      ),
      observe: Schedule.observe(declarations.BillingJobs, BillingQueue, {
        limit: 20
      }).pipe(Effect.provide(Schedule.layer(jobs.schedule)))
    }
  }).pipe(Effect.provide(DefinitionsLayer), Effect.provide(Reactivity.layer))
