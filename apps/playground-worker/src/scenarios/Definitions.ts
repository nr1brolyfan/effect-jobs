import { Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Fixture from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import * as JobPayload from "effect-jobs/JobPayload"
import { EncryptedDocument } from "./PrivateDocument.js"

export type Workload = typeof Workload.Type
export const Workload = Schema.Literals([
  "welcome-email",
  "image-processing",
  "webhook-delivery",
  "private-data-export",
  "catalog-sync",
  "simulated-payment"
])
// Trusted fixture is a provider catalog, not an additional public scenario slot.
export type ProviderWorkload = typeof ProviderWorkload.Type
export const ProviderWorkload = Schema.Literals([
  ...Workload.literals,
  "synthetic-document-export"
])
export type Behavior = typeof Behavior.Type
export const Behavior = Schema.Literals([
  "success",
  "retry-then-success",
  "dead",
  "isolated",
  "accepted-response-lost"
])
export type Payload = typeof Payload.Type
export const Payload = Schema.Struct({
  sandbox: SandboxRef,
  version: Schema.Literal(1),
  seed: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 0xffff_ffff }))
  ),
  sequence: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 10 }))),
  behavior: Behavior,
  actor: Schema.Literal("demo-customer"),
  tenant: Schema.Literals(["demo-tenant-a", "demo-tenant-b"]),
  order: Schema.Literals(["demo-order-a", "demo-order-b"])
})
export type ExportPayload = typeof ExportPayload.Type
export const ExportPayload = Schema.Struct({
  ...Payload.fields,
  document: EncryptedDocument
})

// Readable synthetic editor shape; never accepted as a repair command payload.
export type SyntheticReadablePayload = typeof SyntheticReadablePayload.Type
export const SyntheticReadablePayload = Schema.Struct({
  ...Payload.fields,
  document: Fixture.Document
})

export type SyntheticExportPayload = typeof SyntheticExportPayload.Type
export const SyntheticExportPayload = Schema.Struct({
  ...Payload.fields,
  document: JobPayload.encrypted({
    schema: Fixture.Document,
    codec: {
      envelope: Fixture.Envelope,
      seal: (value) =>
        Fixture.sealSyntheticDocument(value).pipe(
          Effect.mapError(() => new JobPayload.JobEncryptionError())
        ),
      open: (value) =>
        Fixture.openSyntheticDocument(value).pipe(
          Effect.mapError(() => new JobPayload.JobEncryptionError())
        )
    }
  })
})
const communications = JobQueue.make("playground-communications")
const media = JobQueue.make("playground-media")
const commerce = JobQueue.make("playground-commerce")
const privateData = JobQueue.make("playground-private")
export const WelcomeEmail = Job.make({
  queue: communications,
  kind: "playground.welcome-email",
  payload: Payload
})
export const ImageProcessing = Job.make({
  queue: media,
  kind: "playground.image-processing",
  payload: Payload
})
export const WebhookDelivery = Job.make({
  queue: communications,
  kind: "playground.webhook-delivery",
  payload: Payload
})
export const PrivateDataExport = Job.make({
  queue: privateData,
  kind: "playground.private-data-export",
  payload: ExportPayload
})
export const CatalogSync = Job.make({
  queue: commerce,
  kind: "playground.catalog-sync",
  payload: Payload
})
export const SimulatedPayment = Job.make({
  queue: commerce,
  kind: "playground.simulated-payment",
  payload: Payload
})
export const SyntheticDocumentExport = Job.make({
  queue: privateData,
  kind: "playground.synthetic-document-export",
  payload: SyntheticExportPayload
})
export const Producer = JobProducer.make({
  operation: "playground.synthetic",
  slots: [
    "welcome-email",
    "image-processing",
    "webhook-delivery",
    "private-data-export",
    "catalog-sync",
    "simulated-payment"
  ]
})

export const definitions = [
  WelcomeEmail,
  ImageProcessing,
  WebhookDelivery,
  PrivateDataExport,
  CatalogSync,
  SimulatedPayment,
  SyntheticDocumentExport
] as const
