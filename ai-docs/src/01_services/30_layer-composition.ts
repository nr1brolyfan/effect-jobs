/**
 * @title Compose Layers by outputs and requirements
 *
 * Provide available requirements close to the service that needs them; merge
 * independent outputs. Leave only genuinely external requirements for main.
 */
import { Context, Effect, Layer } from "effect"
import { RegistrationStore } from "../fixtures/Auth.js"
import * as RegistrationStandard from "./10_services-and-layers.js"

class DatabaseConfig extends Context.Service<DatabaseConfig, { readonly url: string }>()(
  "effect-auth/ai-docs/DatabaseConfig"
) {}

class Database extends Context.Service<Database, { readonly url: string }>()(
  "effect-auth/ai-docs/Database"
) {}

class Mailer extends Context.Service<
  Mailer,
  { readonly send: (text: string) => Effect.Effect<void> }
>()("effect-auth/ai-docs/Mailer") {}

// These adapters stand in for their own make/layer implementations. They
// produce one service each and still require Database.
declare const registrationStoreLayer: Layer.Layer<RegistrationStore, never, Database>
declare const mailerLayer: Layer.Layer<Mailer, never, Database>
declare const createDatabaseLayer: (url: string) => Layer.Layer<Database>

// If constructing a Layer needs configuration from Effect, unwrap once at
// module scope. Reuse this reference; rebuilding it per provide call defeats
// reference-based memoization (especially for scoped connections).
const DatabaseLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* DatabaseConfig
    return createDatabaseLayer(config.url)
  })
)

// Local provide consumes requirements; it does not add the supplied service
// to the output. DatabaseConfig remains an explicit external requirement.
const RegistrationStoreLayer = registrationStoreLayer.pipe(Layer.provide(DatabaseLayer))
export const RegistrationLayer = RegistrationStandard.layerNoDeps({
  maximumUsernameLength: 100
}).pipe(Layer.provide(RegistrationStoreLayer))

const MailerLayer = mailerLayer.pipe(Layer.provide(DatabaseLayer))

// Merge independent outputs (Registration | Mailer), not dependencies into
// the public output. Shared DatabaseLayer is the same reference in both paths.
export const ServicesLayer = Layer.mergeAll(RegistrationLayer, MailerLayer)

// Only unresolved external config is provided at the application boundary.
declare const databaseConfigLayer: Layer.Layer<DatabaseConfig>
export const ApplicationLayer = ServicesLayer.pipe(Layer.provide(databaseConfigLayer))

// For tests, use RegistrationStandard.layerNoDeps(options) and provide a test
// RegistrationStore instead. Do not call requirements "child" services:
// a Layer produces services, requires services, and Layer.provide connects them.
// If a Layer can only be built dynamically at main, keep that requirement
// there rather than forcing a static default or assuming memoization.
