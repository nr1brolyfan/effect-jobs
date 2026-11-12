// Imports/setup omitted by the README are explicit here, never invented exports.
// Ordinary application services below are test fixtures, not library APIs.
export const names = [
  "overview",
  "contracts",
  "application",
  "handler",
  "slots",
  "node-worker",
  "bounded",
  "native",
  "standalone",
  "codes",
  "failures",
  "policy",
  "encrypted",
  "private-handler",
  "cloud-contracts",
  "cloud-consumer",
  "cloud-application",
  "cloud-stack",
  "migration",
  "drizzle",
  "indexes"
]
export const imports = `import "effect/Schema"
import { Context, Duration, Effect, Layer, Match, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as JobPayload from "effect-jobs/JobPayload"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import * as Polling from "effect-jobs/PollingJobWorker"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlNative from "effect-jobs/PostgreSqlNative"
import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
`
const common = [
  "BillingQueue",
  "SendReceipt",
  "GeneratePdf",
  "Definitions",
  "DefinitionsLayer",
  "CapturedDefinitionsLayer"
]
const fixtures = [
  "jobsStorage",
  "ApplicationPostgresLayer",
  "invoices",
  "operationId",
  "invoiceId",
  "deliveryTimeMillis",
  "ReceiptMailer",
  "ReceiptMailerLayer",
  "ReceiptTemplates",
  "EmailProvider",
  "PrivateReceiptMailer",
  "ReceiptEncryption",
  "InvoicePdfRenderer",
  "InvoicePdfRendererLayer",
  "receiptPolicy",
  "billing",
  "WorkerLayer",
  "tables"
]
// The fence itself is unchanged. Only the test host executes/captures setup below it.
export const wrap = (name, code) => {
  if (!names.includes(name)) {
    throw new Error(`Unknown fence ${name}`)
  }
  const defined = [...code.matchAll(/(?:const|class) (\w+)/g)].map((m) => m[1])
  let prefix = imports
  if (name !== "contracts") {
    const shared = common.filter((binding) => !defined.includes(binding))
    if (shared.length) {
      prefix += `import { ${shared.join(", ")} } from "./contracts.js"\n`
    }
    const app = fixtures.filter((binding) => !defined.includes(binding))
    if (app.length) {
      prefix += `import { ${app.join(", ")} } from "./Fixture.js"\n`
    }
    if (name !== "application") {
      prefix += 'import { IssueInvoice, issueInvoice } from "./application.js"\n'
    }
    if (!["overview", "handler", "failures"].includes(name)) {
      prefix += 'import { ReceiptHandler } from "./handler.js"\n'
    }
  }
  if (["drizzle", "indexes", "native"].includes(name)) {
    prefix +=
      'import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"\nimport { index } from "drizzle-orm/pg-core"\n'
  }
  if (name === "native") {
    prefix +=
      'import * as PgClient from "@effect/sql-pg/PgClient"\nimport * as nativeDrizzle from "drizzle-orm/effect-postgres"\nimport { pgTable, text } from "drizzle-orm/pg-core"\nconst invoiceTable = pgTable("invoices", { id: text("id").primaryKey() })\n'
  }
  if (name === "node-worker") {
    prefix +=
      'import * as PgClient from "@effect/sql-pg/PgClient"\nimport * as NodeRuntime from "@effect/platform-node/NodeRuntime"\n'
  }
  if (name === "private-handler") {
    prefix += 'import { PrivateDefinitions } from "./encrypted.js"\n'
  }
  if (["cloud-consumer", "cloud-application", "cloud-stack"].includes(name)) {
    prefix +=
      'import * as Alchemy from "alchemy"\nimport * as Cloudflare from "alchemy/Cloudflare"\n'
    if (name === "cloud-consumer") {
      prefix +=
        'import { CloudDefinitions, CloudDefinitionsProgram, BillingWorkerLayer } from "./cloud-contracts.js"\n'
    }
    if (name === "cloud-application") {
      prefix +=
        'import { CloudDefinitionsProgram } from "./cloud-contracts.js"\nimport { BillingConsumer } from "./cloud-consumer.js"\n'
    }
    if (name === "cloud-stack") {
      prefix += 'import InvoiceApplication from "./cloud-application.js"\n'
    }
  }
  const generators = [
    "overview",
    "slots",
    "node-worker",
    "bounded",
    "native",
    "standalone",
    "policy",
    "migration"
  ]
  if (generators.includes(name)) {
    const exports = {
      overview: "{ SendReceipt, IssueInvoice, ReceiptHandler, jobsStorage }",
      slots: "IssueInvoiceWithPdf",
      "node-worker": "WorkerLayer",
      policy: "receiptPolicy",
      migration: "{ tables, ddl }"
    }
    return (
      prefix +
      `export const snippet = Effect.gen(function* () {\n${code}\n` +
      (exports[name] ? `return ${exports[name]}\n` : "") +
      "})\n"
    )
  }
  const host = {
    contracts: `export const capturedDefinitions = Effect.runSync(DefinitionsProgram)
export const CapturedDefinitionsLayer = Layer.succeed(Definitions, capturedDefinitions)
export const { BillingQueue, SendReceipt } = capturedDefinitions
export const GeneratePdf = Effect.runSync(Job.make({ queue: BillingQueue, name: "invoice.generate-pdf", payload: Schema.Struct({ invoiceId: Schema.String }) }))`,
    application: `export const application = Effect.runSync(ApplicationProgram.pipe(Effect.provide(CapturedDefinitionsLayer)))
export const { IssueInvoice, issueInvoice } = application
export { InvoiceApplication, InvoiceApplicationLayer }`,
    encrypted: `export const capturedPrivateDefinitions = Effect.runSync(PrivateDefinitionsProgram.pipe(Effect.provide(CapturedDefinitionsLayer)))
export const CapturedPrivateDefinitionsLayer = Layer.succeed(PrivateDefinitions, capturedPrivateDefinitions)
export const { SendPrivateReceipt, PrivateReceiptProducer } = capturedPrivateDefinitions
export { ReceiptDocument, PrivateDefinitions, PrivateDefinitionsLayer, requestPrivateReceipt }`,
    "cloud-contracts": `export const capturedCloudDefinitions = Effect.runSync(CloudDefinitionsProgram.pipe(Effect.provide(CapturedDefinitionsLayer)))
export const { GeneratePdf, CloudInvoiceProducer } = capturedCloudDefinitions
export { CloudDefinitions, CloudDefinitionsProgram, PdfHandler, BillingWorkerLayer }`
  }
  const exports = {
    handler: "ReceiptHandler",
    codes: "Codes",
    failures: "ReceiptHandler",
    "private-handler": "PrivateReceiptHandler",
    drizzle: "jobTables",
    indexes: "jobTables"
  }
  return (
    prefix +
    code +
    (host[name] ? `\n${host[name]}\n` : "") +
    (exports[name] ? `\nexport { ${exports[name]} }\n` : "")
  )
}
