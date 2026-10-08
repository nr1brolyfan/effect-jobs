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
const common = ["BillingQueue", "SendReceipt", "IssueInvoice", "GeneratePdf"]
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
  "ReceiptHandler",
  "issueInvoice",
  "SendPrivateReceipt",
  "tables",
  "BillingWorkerLayer"
]
// Only complete fences are wrapped; code inside each fence remains byte-for-byte.
export const wrap = (name, code) => {
  if (!names.includes(name)) {
    throw new Error(`Unknown fence ${name}`)
  }
  const defined = [...code.matchAll(/(?:const|class) (\w+)/g)].map((m) => m[1])
  const shared = common.filter(
    (binding) =>
      !defined.includes(binding) &&
      !(name === "cloud-application" && binding === "GeneratePdf")
  )
  const app = fixtures.filter(
    (binding) =>
      !defined.includes(binding) &&
      !(
        ["cloud-contracts", "cloud-consumer"].includes(name) &&
        ["ReceiptHandler", "BillingWorkerLayer"].includes(binding)
      )
  )
  let prefix = imports
  if (shared.length && name !== "contracts") {
    prefix += `import { ${shared.join(", ")} } from "./contracts.js"\n`
  }
  if (app.length && name !== "contracts") {
    prefix += `import { ${app.join(", ")} } from "./Fixture.js"\n`
  }
  if (["drizzle", "indexes", "native"].includes(name)) {
    prefix +=
      'import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"\nimport { index } from "drizzle-orm/pg-core"\n'
  }
  if (name === "cloud-contracts") {
    prefix += 'import { ReceiptHandler } from "./handler.js"\n'
  }
  if (name === "cloud-consumer") {
    prefix += 'import { BillingWorkerLayer } from "./cloud-contracts.js"\n'
  }
  if (name === "native") {
    prefix +=
      'import * as nativeDrizzle from "drizzle-orm/effect-postgres"\nimport { pgTable, text } from "drizzle-orm/pg-core"\nconst invoiceTable = pgTable("invoices", { id: text("id").primaryKey() })\n'
  }
  if (name === "node-worker") {
    prefix +=
      'import * as PgClient from "@effect/sql-pg/PgClient"\nimport * as NodeRuntime from "@effect/platform-node/NodeRuntime"\n'
  }
  if (["cloud-consumer", "cloud-application", "cloud-stack"].includes(name)) {
    prefix +=
      'import * as Alchemy from "alchemy"\nimport * as Cloudflare from "alchemy/Cloudflare"\n'
    if (name === "cloud-application") {
      prefix +=
        'import { CloudInvoiceProducer, GeneratePdf } from "./cloud-contracts.js"\n'
    }
    if (name === "cloud-application") {
      prefix += 'import { BillingConsumer } from "./cloud-consumer.js"\n'
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
    "encrypted",
    "migration"
  ]
  if (generators.includes(name)) {
    const exports = {
      overview: "{ SendReceipt, IssueInvoice, ReceiptHandler, jobsStorage }",
      slots: "IssueInvoiceWithPdf",
      "node-worker": "WorkerLayer",
      policy: "receiptPolicy",
      encrypted: "{ SendPrivateReceipt, ReceiptDocument, PrivateReceiptProducer }",
      migration: "{ tables, ddl }"
    }
    return (
      prefix +
      `export const snippet = Effect.gen(function* () {\n${code}\n` +
      (exports[name] ? `return ${exports[name]}\n` : "") +
      "})\n"
    )
  }
  const exportBindings = {
    contracts: null,
    application: "issueInvoice",
    handler: "ReceiptHandler",
    codes: "Codes",
    failures: "ReceiptHandler",
    "private-handler": "PrivateReceiptHandler",
    "cloud-contracts":
      "GeneratePdf, CloudInvoiceProducer, PdfHandler, BillingWorkerLayer",
    drizzle: "jobTables",
    indexes: "jobTables"
  }
  return (
    prefix +
    (name === "contracts"
      ? code +
        '\nexport const GeneratePdf = Job.make({ queue: BillingQueue, kind: "invoice.generate-pdf", payload: Schema.Struct({ invoiceId: Schema.String }) })\n'
      : code) +
    (exportBindings[name] ? `\nexport { ${exportBindings[name]} }\n` : "")
  )
}
