import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { EncryptedDocument } from "./PrivateDocument.js"

export const Workload = Schema.Literals([
  "welcome-email",
  "image-processing",
  "webhook-delivery",
  "private-data-export",
  "catalog-sync",
  "simulated-payment"
])
export type Workload = typeof Workload.Type
export const Behavior = Schema.Literals([
  "success",
  "retry-then-success",
  "dead",
  "isolated",
  "accepted-response-lost"
])
export type Behavior = typeof Behavior.Type
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
export type Payload = typeof Payload.Type
export const ExportPayload = Schema.Struct({
  ...Payload.fields,
  document: EncryptedDocument
})
export type ExportPayload = typeof ExportPayload.Type

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
  SimulatedPayment
] as const
