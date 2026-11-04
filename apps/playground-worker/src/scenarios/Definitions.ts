import { Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobGroup from "effect-jobs/JobGroup"
import type { JobPolicy } from "effect-jobs/JobPolicy"
import { defaultPolicy } from "effect-jobs/JobPolicy"
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
  kind: "playground.welcome-email",
  payload: Payload
})
export const ImageProcessing = Job.make({
  kind: "playground.image-processing",
  payload: Payload
})
export const WebhookDelivery = Job.make({
  kind: "playground.webhook-delivery",
  payload: Payload
})
export const PrivateDataExport = Job.make({
  kind: "playground.private-data-export",
  payload: ExportPayload
})
export const CatalogSync = Job.make({
  kind: "playground.catalog-sync",
  payload: Payload
})
export const SimulatedPayment = Job.make({
  kind: "playground.simulated-payment",
  payload: Payload
})
export const SyntheticDocumentExport = Job.make({
  kind: "playground.synthetic-document-export",
  payload: SyntheticExportPayload
})
export const makeProducer = (policy: JobPolicy = defaultPolicy) =>
  JobProducer.make({
    operation: "playground.synthetic",
    slots: {
      "welcome-email": { job: WelcomeEmail, queue: communications, policy },
      "image-processing": { job: ImageProcessing, queue: media, policy },
      "webhook-delivery": { job: WebhookDelivery, queue: communications, policy },
      "private-data-export": { job: SyntheticDocumentExport, queue: privateData, policy },
      "catalog-sync": { job: CatalogSync, queue: commerce, policy },
      "simulated-payment": { job: SimulatedPayment, queue: commerce, policy }
    }
  })
export const Producer = makeProducer()

export const definitions = [
  WelcomeEmail,
  ImageProcessing,
  WebhookDelivery,
  PrivateDataExport,
  CatalogSync,
  SimulatedPayment,
  SyntheticDocumentExport
] as const

/** Application routing inventory; job contracts themselves have no queue. */
export const routes = [
  { job: WelcomeEmail, queue: communications },
  { job: ImageProcessing, queue: media },
  { job: WebhookDelivery, queue: communications },
  { job: PrivateDataExport, queue: privateData },
  { job: CatalogSync, queue: commerce },
  { job: SimulatedPayment, queue: commerce },
  { job: SyntheticDocumentExport, queue: privateData }
] as const

/** Fixture/read metadata from the application's explicit routing inventory. */
export const catalogFor = (job: (typeof definitions)[number]) => ({
  queue: routes.find((route) => route.job === job)!.queue.name,
  kind: job.kind,
  version: job.version
})

export const group = JobGroup.make("playground-scenarios", {
  welcomeEmail: WelcomeEmail,
  imageProcessing: ImageProcessing,
  webhookDelivery: WebhookDelivery,
  privateDataExport: PrivateDataExport,
  catalogSync: CatalogSync,
  simulatedPayment: SimulatedPayment,
  syntheticDocumentExport: SyntheticDocumentExport
})
