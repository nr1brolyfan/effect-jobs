import { Context, Effect, Layer, Schema } from "effect"
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

export const operation = "playground.synthetic"

export const make = Effect.gen(function* () {
  const SyntheticExportPayload = Schema.Struct({
    ...Payload.fields,
    document: yield* JobPayload.encrypted({
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

  const ExportPayload = Schema.Struct({
    ...Payload.fields,
    document: yield* EncryptedDocument
  })

  const communications = JobQueue.make(Catalogs.WelcomeEmail.catalog.queue)
  const media = JobQueue.make(Catalogs.ImageProcessing.catalog.queue)
  const commerce = JobQueue.make(Catalogs.CatalogSync.catalog.queue)
  const privateData = JobQueue.make(Catalogs.PrivateDataExport.catalog.queue)
  const WelcomeEmail = yield* Job.make({
    queue: communications,
    name: Catalogs.WelcomeEmail.catalog.name,
    payload: Payload
  })
  const ImageProcessing = yield* Job.make({
    queue: media,
    name: Catalogs.ImageProcessing.catalog.name,
    payload: Payload
  })
  const WebhookDelivery = yield* Job.make({
    queue: communications,
    name: Catalogs.WebhookDelivery.catalog.name,
    payload: Payload
  })
  const PrivateDataExport = yield* Job.make({
    queue: privateData,
    name: Catalogs.PrivateDataExport.catalog.name,
    payload: ExportPayload
  })
  const CatalogSync = yield* Job.make({
    queue: commerce,
    name: Catalogs.CatalogSync.catalog.name,
    payload: Payload
  })
  const SimulatedPayment = yield* Job.make({
    queue: commerce,
    name: Catalogs.SimulatedPayment.catalog.name,
    payload: Payload
  })
  const SyntheticDocumentExport = yield* Job.make({
    queue: privateData,
    name: Catalogs.SyntheticDocumentExport.catalog.name,
    payload: SyntheticExportPayload
  })
  const Producer = yield* JobProducer.make({
    operation,
    slots: {
      "welcome-email": WelcomeEmail,
      "image-processing": ImageProcessing,
      "webhook-delivery": WebhookDelivery,
      "private-data-export": PrivateDataExport,
      "catalog-sync": CatalogSync,
      "simulated-payment": SimulatedPayment
    }
  })

  const ShowcaseProducer = yield* JobProducer.make({
    operation: "playground.synthetic-showcase",
    slots: { "encrypted-document": SyntheticDocumentExport }
  })

  const definitions = [
    WelcomeEmail,
    ImageProcessing,
    WebhookDelivery,
    PrivateDataExport,
    CatalogSync,
    SimulatedPayment,
    SyntheticDocumentExport
  ] as const

  return {
    SyntheticExportPayload,
    ExportPayload,
    WelcomeEmail,
    ImageProcessing,
    WebhookDelivery,
    PrivateDataExport,
    CatalogSync,
    SimulatedPayment,
    SyntheticDocumentExport,
    Producer,
    ShowcaseProducer,
    definitions
  }
})

export type Setup = Effect.Success<typeof make>
export type ExportPayload = Setup["ExportPayload"]["Type"]
export type SyntheticExportPayload = Setup["SyntheticExportPayload"]["Type"]
export class Definitions extends Context.Service<Definitions, Setup>()(
  "playground/Definitions"
) {}
// Reuse this reference in the application's single memoized graph.
export const layer = Layer.effect(Definitions, make)
