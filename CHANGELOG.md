# Changelog

## 0.1.0-alpha.1

Breaking prerelease API changes since alpha.0:

- Resolve ambient `enqueue` through `JobEnqueue` on the same active PgClient;
  use `enqueueStandalone` for an explicitly owned transaction.
- Use immutable `JobPolicy.defaultPolicy` and validated typed `FailureCode` catalogs.
- Bind `JobPayload.encrypted` to a domain Schema and application key service.
- Default job version to 1 and infer the standard encoder; add optional Drizzle
  `extraIndexes` without changing the required baseline.
- Preserve mixed codec Causes and qualify the revised README against the exact
  package, pinned Alchemy declarations, Node/Bun and native PostgreSQL fixtures.

Cloudflare external PostgreSQL and deployment remain NotTested. This changelog
describes the release candidate; registry publication is a separate owner action.

## 0.1.0-alpha.0

Initial alpha extraction of the Effect-native durable jobs mechanism from
MIT-licensed effect-auth, with application-owned domains and infrastructure.

- Schema-defined catalogs, typed producer slots and library-generated job IDs.
- Transaction-bound production and immutable semantic duplicate comparison.
- PostgreSQL two-table storage, fixed leases, fencing, retry and bounded recovery.
- Explicit scoped workers, bounded cleanup and protected-payload projection.
- Focused ESM exports and optional effect-native Drizzle migration declarations.

This is an alpha, not a production qualification claim. Exact versions and
unsupported cases are listed in README and the release qualification document.
No registry publication or cryptographic build provenance is claimed by this file.
