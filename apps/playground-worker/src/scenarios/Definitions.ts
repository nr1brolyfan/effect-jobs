import { Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import * as Catalogs from "@effect-jobs/playground-contracts/ScenarioCatalogs"
import { Payload } from "@effect-jobs/playground-contracts/ScenarioPayloads"
import * as Fixture from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import * as JobPayload from "effect-jobs/JobPayload"
import { EncryptedDocument } from "./PrivateDocument.js"
export {
  Workload,
  ProviderWorkload,
  Behavior,
  Payload,
  SyntheticReadablePayload
} from "@effect-jobs/playground-contracts/ScenarioPayloads"

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

export type ExportPayload = typeof ExportPayload.Type
export const ExportPayload = Schema.Struct({
  ...Payload.fields,
  document: EncryptedDocument
})

const communications = JobQueue.make(Catalogs.WelcomeEmail.catalog.queue)
const media = JobQueue.make(Catalogs.ImageProcessing.catalog.queue)
const commerce = JobQueue.make(Catalogs.CatalogSync.catalog.queue)
const privateData = JobQueue.make(Catalogs.PrivateDataExport.catalog.queue)
export const WelcomeEmail = Job.make({
  queue: communications,
  name: Catalogs.WelcomeEmail.catalog.name,
  payload: Payload
})
export const ImageProcessing = Job.make({
  queue: media,
  name: Catalogs.ImageProcessing.catalog.name,
  payload: Payload
})
export const WebhookDelivery = Job.make({
  queue: communications,
  name: Catalogs.WebhookDelivery.catalog.name,
  payload: Payload
})
export const PrivateDataExport = Job.make({
  queue: privateData,
  name: Catalogs.PrivateDataExport.catalog.name,
  payload: ExportPayload
})
export const CatalogSync = Job.make({
  queue: commerce,
  name: Catalogs.CatalogSync.catalog.name,
  payload: Payload
})
export const SimulatedPayment = Job.make({
  queue: commerce,
  name: Catalogs.SimulatedPayment.catalog.name,
  payload: Payload
})
export const SyntheticDocumentExport = Job.make({
  queue: privateData,
  name: Catalogs.SyntheticDocumentExport.catalog.name,
  payload: SyntheticExportPayload
})
export const Producer = JobProducer.make({
  operation: "playground.synthetic",
  slots: {
    "welcome-email": WelcomeEmail,
    "image-processing": ImageProcessing,
    "webhook-delivery": WebhookDelivery,
    "private-data-export": PrivateDataExport,
    "catalog-sync": CatalogSync,
    "simulated-payment": SimulatedPayment
  }
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
