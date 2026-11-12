import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobGroup from "effect-jobs/JobGroup"
import type { JobPolicy } from "effect-jobs/JobPolicy"
import { defaultPolicy } from "effect-jobs/JobPolicy"
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
    name: Catalogs.WelcomeEmail.catalog.name,
    payload: Payload
  })
  const ImageProcessing = yield* Job.make({
    name: Catalogs.ImageProcessing.catalog.name,
    payload: Payload
  })
  const WebhookDelivery = yield* Job.make({
    name: Catalogs.WebhookDelivery.catalog.name,
    payload: Payload
  })
  const PrivateDataExport = yield* Job.make({
    name: Catalogs.PrivateDataExport.catalog.name,
    payload: ExportPayload
  })
  const CatalogSync = yield* Job.make({
    name: Catalogs.CatalogSync.catalog.name,
    payload: Payload
  })
  const SimulatedPayment = yield* Job.make({
    name: Catalogs.SimulatedPayment.catalog.name,
    payload: Payload
  })
  const SyntheticDocumentExport = yield* Job.make({
    name: Catalogs.SyntheticDocumentExport.catalog.name,
    payload: SyntheticExportPayload
  })
  const makeProducer = (policy: JobPolicy = defaultPolicy) =>
    JobProducer.make(operation).pipe(
      JobProducer.withSlot("welcome-email", WelcomeEmail, {
        queue: communications,
        policy
      }),
      JobProducer.withSlot("image-processing", ImageProcessing, { queue: media, policy }),
      JobProducer.withSlot("webhook-delivery", WebhookDelivery, {
        queue: communications,
        policy
      }),
      JobProducer.withSlot("private-data-export", SyntheticDocumentExport, {
        queue: privateData,
        policy
      }),
      JobProducer.withSlot("catalog-sync", CatalogSync, { queue: commerce, policy }),
      JobProducer.withSlot("simulated-payment", SimulatedPayment, {
        queue: commerce,
        policy
      })
    )
  const Producer = yield* makeProducer()
  const ShowcaseProducer = yield* JobProducer.make("playground.synthetic-showcase").pipe(
    JobProducer.withSlot("encrypted-document", SyntheticDocumentExport, {
      queue: privateData
    })
  )
  const routes = [
    { job: WelcomeEmail, queue: communications },
    { job: ImageProcessing, queue: media },
    { job: WebhookDelivery, queue: communications },
    { job: PrivateDataExport, queue: privateData },
    { job: CatalogSync, queue: commerce },
    { job: SimulatedPayment, queue: commerce },
    { job: SyntheticDocumentExport, queue: privateData }
  ] as const
  const catalogFor = (job: (typeof routes)[number]["job"]) => ({
    queue: routes.find((route) => route.job === job)!.queue.name,
    name: job.name,
    version: job.version
  })
  const group = JobGroup.make("playground-scenarios", {
    welcomeEmail: WelcomeEmail,
    imageProcessing: ImageProcessing,
    webhookDelivery: WebhookDelivery,
    privateDataExport: PrivateDataExport,
    catalogSync: CatalogSync,
    simulatedPayment: SimulatedPayment,
    syntheticDocumentExport: SyntheticDocumentExport
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
    makeProducer,
    routes,
    PrivateDataQueue: privateData,
    catalogFor,
    group,
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
