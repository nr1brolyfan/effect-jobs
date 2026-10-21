/**
 * @title Library Layer design guide
 *
 * Keep application setup short without hiding replacement paths or resource
 * ownership. These examples use documentation fixtures, not new package APIs.
 */
import { Layer } from "effect"
import { RegistrationStore } from "../fixtures/Auth.js"
import * as RegistrationStandard from "./10_services-and-layers.js"

// COMPOSITION LEVELS
// Start with focused services and open implementation Layers. Add useful feature
// compositions (password, sessions, registration), independent backend/runtime
// adapters, and transport Layers. Keep common deployment presets thin recipes
// over those same implementations, not separate auth engines or provider registries.
// Do not generate every platform/backend/method combination or enable unrelated
// capabilities merely because they share a preset.

// LOCAL DEFAULTS
// Provide dependencies locally when this composition owns their default choice.
// Leave deployment capabilities and application decisions as explicit requirements.
// Keep an unprovided constructor Layer for replacing public dependencies; not every
// service needs both an open Layer and a standard composition.
// layerNoDeps means no dependency Layers are supplied, not that In is never.
// Layer<Out, Error, In> states the real contract; do not erase remaining inputs or
// custom setup errors to make a preset appear closed. Capture implementation
// dependencies at construction, not in every service operation's requirements.

declare const options: RegistrationStandard.RegistrationLayerOptions
declare const StandardStoreLayer: Layer.Layer<RegistrationStore>
declare const CustomStoreLayer: Layer.Layer<RegistrationStore>

// A standard composition supplies its selected store before building Registration.
// Layer.provide hides the store from the output; use provideMerge only when its
// services intentionally belong to the public result. mergeAll combines outputs,
// but does not supply one merged Layer's output to another's constructor.
export const RegistrationLayer = RegistrationStandard.layerNoDeps(options).pipe(
  Layer.provide(StandardStoreLayer)
)

// Replacement is an alternative construction, not a patch to a built service.
export const CustomRegistrationLayer = RegistrationStandard.layerNoDeps(options).pipe(
  Layer.provide(CustomStoreLayer)
)

/*
// Avoid: this does not replace the store already selected inside RegistrationLayer.
const LateOverrideLayer = RegistrationLayer.pipe(Layer.provide(CustomStoreLayer))
*/

// If a preset offers component selection, select provider Layers before provide.
// Reuse the open implementations, preserve each selected Layer's Error and In,
// and never acquire the discarded default. A replacement must reach every intended
// consumer, not just overwrite a tag in the final Context.
// Private commit/reconcile authority stays private. Replace tightly coupled
// authority as a coherent unit when independent substitution would break invariants.

// SHARING AND LIFETIME
// Reuse one configured Layer reference wherever one resource should be shared.
// Memoization is by reference within a shared MemoMap and live scopes, not by
// service tag, equal configuration, or process-wide singleton identity.
// Repeated factory calls or separate Effect.provide calls can rebuild resources.
// Layer.unwrap supports effectful configuration behind a stable Layer reference;
// see 30_layer-composition.ts. One reused runtime/handler owns the built graph.
// Do not share the same open Layer under different inputs in one MemoMap expecting
// separate instances: input Context is not a memoization key. Isolate installations.
// Sharing a connection-source adapter does not extend a physical connection's
// lifetime. Keep request state, SQL leases and transactions in their proper scopes;
// never retain invocation-bound resources across Workers invocations.

// SAFE DEFAULTS
// Supply canonical internal plumbing and coherent, validated configuration defaults.
// Keep secrets, trusted origins/ingress, product authorization, external providers
// and resource ownership explicit. Missing required capability fails closed; do not
// silently select in-memory persistence, disabled limiting or permissive checks.
// Imports and ordinary auth assembly start no migrations, provisioning or background
// workers. Worker execution has a separate explicit lifetime owner; required durable
// consequences still need handlers. Do not drop required audit or jobs for brevity.

// LIBRARY MODULE BOUNDARIES
// Export make/Layers from implementation modules, not as concrete implementation
// statics on portable service tags. Keep platform adapters on separate subpaths;
// contract/client imports must not resolve native crypto, SQL drivers or deployment
// tooling. Static Layers remain useful for app-owned services in one deployment.
// Preserve shared database/source identity and transaction semantics when composing
// auth with application writes. A shorter setup is not permission to change authority,
// replay or unknown-commit behavior. A preset is not proof of runtime qualification.

// REVIEW BEFORE SHIPPING
// Can a consumer use a concise standard composition and replace public providers
// without copying library wiring? Does the replacement reach all intended consumers?
// Do types retain missing requirements and custom setup errors? Are rejected defaults
// unused? Do tests prove acquisition/sharing/isolation and cleanup on failure or
// interruption? Do packed consumers prove platform/optional-peer isolation and the
// actual supported runtime/backend behavior? Do not infer these from naming alone.
