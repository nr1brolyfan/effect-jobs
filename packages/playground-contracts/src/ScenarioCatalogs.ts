// Portable catalog identities; execution definitions and private codecs stay worker-owned.
export const WelcomeEmail = {
  catalog: {
    queue: "playground-communications",
    name: "playground.welcome-email",
    version: 1
  }
} as const
export const ImageProcessing = {
  catalog: { queue: "playground-media", name: "playground.image-processing", version: 1 }
} as const
export const WebhookDelivery = {
  catalog: {
    queue: "playground-communications",
    name: "playground.webhook-delivery",
    version: 1
  }
} as const
export const PrivateDataExport = {
  catalog: {
    queue: "playground-private",
    name: "playground.private-data-export",
    version: 1
  }
} as const
export const CatalogSync = {
  catalog: { queue: "playground-commerce", name: "playground.catalog-sync", version: 1 }
} as const
export const SimulatedPayment = {
  catalog: {
    queue: "playground-commerce",
    name: "playground.simulated-payment",
    version: 1
  }
} as const
export const SyntheticDocumentExport = {
  catalog: {
    queue: "playground-private",
    name: "playground.synthetic-document-export",
    version: 1
  }
} as const
export const definitions = [
  WelcomeEmail,
  ImageProcessing,
  WebhookDelivery,
  PrivateDataExport,
  CatalogSync,
  SimulatedPayment,
  SyntheticDocumentExport
] as const
