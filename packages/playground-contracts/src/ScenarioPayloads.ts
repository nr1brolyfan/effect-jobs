import { Schema } from "effect"
import { SandboxRef } from "./Sandbox.js"
import * as Fixture from "./SyntheticDocument.js"

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
// Readable synthetic editor shape; never accepted as a repair command payload.
export type SyntheticReadablePayload = typeof SyntheticReadablePayload.Type
export const SyntheticReadablePayload = Schema.Struct({
  ...Payload.fields,
  document: Fixture.Document
})

// Encoded wire schema only; no key acquisition or encryption implementation.
export type SyntheticExportPayload = typeof SyntheticExportPayload.Type
export const SyntheticExportPayload = Schema.Struct({
  ...Payload.fields,
  document: Fixture.Envelope
})
