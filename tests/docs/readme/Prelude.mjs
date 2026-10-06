// Imports and application parameters for EVERY exact README fence.
// Run.mjs extracts fences; NativePrelude/NativeApplication are real pinned wiring.
// Smoke.ts.txt supplies portable test doubles, never claims to execute PostgreSQL.
const sharedImports = `import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as Codec from "effect-jobs/JobPayloadCodec"
`
const consumerImports = `import { Effect, Layer } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import * as Polling from "effect-jobs/PollingJobWorker"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import type * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import { BillingQueue, SendReceipt } from "./shared.js"
import { ReceiptMailer } from "./Services.js"
`
export const wrap = (name, code) => {
  const frames = {
    shared: [sharedImports, `export { BillingQueue, IssueInvoice, SendReceipt }\n`],
    transaction: [
      `import { Effect } from "effect"
import type * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { SendReceipt, IssueInvoice } from "./shared.js"
import { transact, invoices, receipts } from "./NativePrelude.mjs"
import type { NativeDb } from "./NativePrelude.mjs"
import type { NativeApplication } from "./NativeApplication.mjs"
export const applicationServer = (
  db: NativeDb,
  ApplicationTransactions: NativeApplication,
  backend: PostgreSqlJobs.Backend
) => {
`,
      `return { issueInvoice }\n}\n`
    ],
    handler: [
      consumerImports +
        `export const workerLayers = (
  backend: Pick<PostgreSqlJobs.Backend, "store">,
  ReceiptMailerLayer: Layer.Layer<ReceiptMailer>
) => {
`,
      `return { HandlerLayer, WorkerLayer }\n}\n`
    ],
    polling: [
      consumerImports +
        `import { workerLayers } from "./handler.js"
export const consumerProcess = (
  backend: Pick<PostgreSqlJobs.Backend, "store" | "ready">,
  ReceiptMailerLayer: Layer.Layer<ReceiptMailer>
) => {
  const { WorkerLayer } = workerLayers(backend, ReceiptMailerLayer)
`,
      `return { runWorker }\n}\n`
    ],
    migration: [
      `import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"\n`,
      `export { tables, migrationSql }\n`
    ],
    drizzle: [
      `import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
import { tables } from "./migration.js"
`,
      `export { jobTables }\n`
    ],
    policy: [
      `import { Duration, Effect } from "effect"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { JobFailures } from "effect-jobs/JobFailure"
`,
      `export { policy, rejected, uncertain }\n`
    ],
    protection: [
      `import { Schema } from "effect"
import * as JobPayload from "effect-jobs/JobPayload"
import * as Codec from "effect-jobs/JobPayloadCodec"
`,
      `export { ProtectedDocument, DocumentPayload, encodeDocument }\n`
    ]
  }
  const frame = frames[name]
  if (!frame) {
    throw new Error(`Unknown README fence: ${name}`)
  }
  return frame[0] + code + frame[1]
}
