import assert from "node:assert/strict"

export const names = [
  "job",
  "producer",
  "postgres-transaction",
  "policy",
  "catalog",
  "handlers",
  "worker",
  "failure-codes",
  "failure-adapter",
  "alchemy-fetch",
  "alchemy-drain",
  "sqlite-binding",
  "sqlite-transaction",
  "sqlite-drain",
  "multiple-slots"
]

export const fences = (markdown) => {
  const blocks = [...markdown.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)]
  assert.equal(blocks.length * 2, [...markdown.matchAll(/^```/gm)].length)
  assert(blocks.every(([, language]) => ["ts", "sh"].includes(language)))
  return blocks
}

const gen = (body) => `Effect.gen(function* () {\n${body}\n})`
export const jobDefinition = (code) => `
import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
${code}
export { SendOrderConfirmation }
`

// Fence bytes are preserved. Parameters stand for the enclosing application's
// services and values. The linked examples separately exercise the real I/O.
export const modules = (snippets) => {
  assert.equal(
    snippets.length,
    names.length,
    "Update the visible TypeScript fence inventory"
  )
  const [
    job,
    producer,
    transaction,
    policy,
    catalog,
    handlers,
    worker,
    codes,
    failures,
    alchemyFetch,
    alchemyDrain,
    sqliteBinding,
    sqliteTransaction,
    sqliteDrain,
    slots
  ] = snippets
  return {
    VisibleJob: jobDefinition(job),
    VisibleOrders: `
import { Data, Duration, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobApi from "effect-jobs/JobApi"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as JobRetryPolicy from "effect-jobs/JobRetryPolicy"
import * as JobWorker from "effect-jobs/JobWorker"
import * as JobStorage from "effect-jobs/JobStorage"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { SendOrderConfirmation } from "./VisibleJob.js"

class EmailBusy extends Data.TaggedError("EmailBusy")<{}> {}
class AddressRejected extends Data.TaggedError("AddressRejected")<{}> {}
class InconsistentOrder extends Data.TaggedError("InconsistentOrder")<{}> {}
class EmailUncertain extends Data.TaggedError("EmailUncertain")<{}> {}

interface EmailMessage {
  readonly deliveryKey: string
  readonly subject: string
  readonly body: string
}
interface Emails {
  readonly send: (message: EmailMessage) => Effect.Effect<void, EmailBusy | AddressRejected | InconsistentOrder | EmailUncertain>
}

${codes}
export const definitions = ${gen(`
${producer}
return { confirmation, OrdersQueue, PlaceOrder }
`)}
export const ordersWorker = (emails: Emails, OrdersStorage: Layer.Layer<JobStorage.JobStorage>) => ${gen(`
const { confirmation, OrdersQueue } = yield* definitions
${policy}
${catalog}
${failures}
${handlers}
${worker}
return { OrdersWorker, confirmationPolicy }
`)}
export const expandedProducer = ${gen(`
const { confirmation, OrdersQueue } = yield* definitions
const createInvoice = yield* Job.make({ name: "orders.invoice", payload: Schema.Struct({ orderId: Schema.String }) })
const notifyWarehouse = yield* Job.make({ name: "orders.notify-warehouse", payload: Schema.Struct({ orderId: Schema.String }) })
const BillingQueue = yield* JobQueue.make("billing")
const FulfillmentQueue = yield* JobQueue.make("fulfillment")
${slots}
return PlaceOrder
`)}
`,
    VisiblePostgres: `
import { Effect } from "effect"
import type { PgClient } from "@effect/sql-pg/PgClient"
import { pgTable, text } from "drizzle-orm/pg-core"
import * as NativeDrizzle from "drizzle-orm/effect-postgres"
import type * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { definitions } from "./VisibleOrders.js"
const orders = pgTable("orders", { orderId: text("order_id").primaryKey() })
export const placeOrder = (pg: PgClient, db: Effect.Success<ReturnType<typeof NativeDrizzle.make>>, jobs: PostgreSqlJobs.Service, operationId: string, order: typeof orders.$inferInsert) => ${gen(`
const { PlaceOrder } = yield* definitions
${transaction}
`)}
`,
    VisibleAlchemyFetch: `
import { Effect, type Redacted } from "effect"
import { HttpServerResponse, type HttpServerRequest } from "effect/http"
type IssueRequest = { readonly requestId: string; readonly invoiceId: string }
interface Coordinator {
  readonly prearm: () => Effect.Effect<void, Error>
  readonly wake: () => Effect.Effect<void, Error>
}
export const fetch = (
  request: HttpServerRequest.HttpServerRequest,
  coordinators: { readonly getByName: (name: string) => Coordinator },
  databaseUrl: Redacted.Redacted<string>,
  providerUrl: string,
  admitDevelopment: (authorization: string) => Effect.Effect<string, Error>,
  decodeRequest: (body: unknown) => Effect.Effect<IssueRequest, Error>,
  openInvocation: (settings: { readonly databaseUrl: Redacted.Redacted<string>; readonly providerUrl: string }) => Effect.Effect<{
    readonly issue: (tenantId: string, input: IssueRequest) => Effect.Effect<{ readonly jobId: string }, Error>
  }, Error, import("effect/Scope").Scope>
) => ${gen(alchemyFetch)}
`,
    VisibleAlchemyDrain: `
import { Effect, type Layer } from "effect"
import type * as JobQueue from "effect-jobs/JobQueue"
import * as JobWorker from "effect-jobs/JobWorker"
export const billingDrain = (BillingQueue: JobQueue.JobQueue<"billing">, WorkerLayer: Layer.Layer<JobWorker.JobWorker>) => {
${alchemyDrain}
return drain
}
`,
    VisibleSqliteBinding: `
import { Effect } from "effect"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { join } from "node:path"
interface InvoiceJobs {
  fetch(request: Request): Promise<Response>
}
export const stack = ${gen(`
${sqliteBinding}
return worker
`)}
`,
    VisibleSqlite: `
import { Effect, Schema, type Layer } from "effect"
import * as DurableObjectSqlite from "effect-jobs/DurableObjectSqlite"
import { EnqueueResult } from "effect-jobs/JobContract"
import * as Job from "effect-jobs/Job"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobWorker from "effect-jobs/JobWorker"

const Invoice = Schema.Struct({ invoiceId: Schema.String, amountCents: Schema.Int })
const insertInvoice = (sql: DurableObjectSqlite.SqlStorage, id: string, invoice: typeof Invoice.Type) => {
  sql.exec("INSERT INTO invoices VALUES (?, ?, ?)", id, invoice.invoiceId, invoice.amountCents)
}
export const issue = (storage: DurableObjectSqlite.TransactionStorage & DurableObjectSqlite.Storage, responseBudgetMillis: number, operationId: string, invoice: typeof Invoice.Type) => ${gen(`
const queue = yield* JobQueue.make("invoices")
const record = yield* Job.make({ name: "invoice.record", payload: Invoice })
const producer = yield* JobProducer.make("invoice.issue").pipe(JobProducer.withSlot("record", record, { queue }))
${sqliteTransaction}
return result
`)}
export const invoiceDrain = (queue: JobQueue.JobQueue<"invoices">, workerLayer: Layer.Layer<JobWorker.JobWorker>) => {
${sqliteDrain}
return drainInvoices
}
`
  }
}
