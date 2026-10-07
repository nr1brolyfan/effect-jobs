// Explicit application wiring around the exact README fences; test doubles live in Smoke.
// The backend is constructed without SQL. Production supplies a qualified adapter,
// app-owned pools/migrations, and an idempotent renderInvoice implementation.
const billingImports = `import { Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import type { ApplicationAdapter } from "effect-jobs/PostgreSqlTransaction"
import type { HandlerInput } from "effect-jobs/JobContract"
import type { JobFailure } from "effect-jobs/JobFailure"
`

export const wrap = (name, code) => {
  if (name === "billing") {
    const boundary = code.indexOf("// backend and renderInvoice")
    if (boundary < 0) {
      throw new Error("Missing overview application boundary")
    }
    return (
      billingImports +
      code.slice(0, boundary) +
      `
export { BillingQueue, Producer, GenerateInvoice }
export const billingWithBackend = (
  backend: Pick<PostgreSqlJobs.Backend, "store" | "ready" | "withTransaction">,
  renderInvoice: (input: HandlerInput<typeof GenerateInvoice.payload.Type>) => Effect.Effect<void, JobFailure>
) => {
` +
      code.slice(boundary) +
      `
  return { enqueue, drain }
}
export const billing = (
  applicationAdapter: ApplicationAdapter,
  renderInvoice: (input: HandlerInput<typeof GenerateInvoice.payload.Type>) => Effect.Effect<void, JobFailure>
) => billingWithBackend(Effect.runSync(PostgreSqlJobs.make({
  schema: "billing", operationResponseBudgetMillis: 100
}).pipe(Effect.provideService(PostgreSqlApplication, applicationAdapter))), renderInvoice)
`
    )
  }
  const frames = {
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
    transaction: [
      `import { Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import type { Backend } from "effect-jobs/PostgreSqlJobs"
import { GenerateInvoice, Producer } from "./billing.js"
import * as JobPolicy from "effect-jobs/JobPolicy"
declare const client: SqlClient
declare const backend: Backend
declare const operationId: string
declare const invoiceId: string
`,
      `export { issueInvoice }\n`
    ],
    encrypted: [
      `import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobPayload from "effect-jobs/JobPayload"
declare const ReceiptEncryption: JobPayload.EncryptionCodec<{ readonly recipient: string; readonly amount: number }, Schema.Struct<{ ciphertext: Schema.String; fingerprint: Schema.String }>>
`,
      `export { SendReceipt }\n`
    ],
    policy: [
      `import { Duration, Effect } from "effect"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { JobFailures } from "effect-jobs/JobFailure"
import * as FailureCodes from "effect-jobs/FailureCode"
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
