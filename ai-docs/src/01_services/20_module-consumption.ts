/**
 * @title Consume implementation modules as namespaces
 *
 * Prefer namespace imports when a module is primarily consumed through generic
 * constructors such as make, layer, or layerNoDeps. The namespace is an ESM
 * module namespace, not a service dependency or a static-method API.
 * For this library, keep Layers as top-level exports in implementation modules
 * (e.g. RegistrationLayer.layerNoDeps(options), PostgreSqlSession.layer(options)).
 * Static properties on a service class are convenient in backend-only apps,
 * but even unused defaults/mocks may be bundled with that class. Avoid them
 * for public libraries and code shared with the browser. For example, import
 * JobHandlerRegistryLayer from the JobQueue module, not from a service static.
 *
 * Maintained PostgreSQL sessions are composed from the focused
 * `PostgreSqlSession.layer(options)` entrypoint. The application provides one
 * `PostgreSqlPool` plus `SessionBearerCryptography`, `SessionPolicy`, and
 * `SessionAdmission`; the binding never creates or owns a second pool.
 * `SessionIssuanceCommit` is intentionally absent from the public entrypoint:
 * only the authentication coordinator receives its sealed internal layer.
 */
import * as RegistrationStandard from "./10_services-and-layers.js"

export const RegistrationLayer = RegistrationStandard.layerNoDeps({
  maximumUsernameLength: 100
})

// Keep named imports for domain tags, Schemas, errors, and focused types. Do not
// add wrapper objects or classes merely to manufacture dotted syntax.
// Name top-level bindings for stand-alone Layers with a *Layer suffix (e.g.
// RegistrationLayer); inside an implementation module use `layer` / `layerNoDeps`.
// Prefer these descriptive names over *Live, Default, or a generic Layer* prefix.
